/* =========================================================================
   德撲錦標賽 — 多人連線 Server
   - HTTP serve public/
   - WebSocket 房間 + 訊息 dispatcher
   - 跑 AI 自動行動
   ========================================================================= */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game, aiDecide, CHARACTERS, POWER_UPS, MODES, modeDetail } = require('./game-engine');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ============ 全域狀態 ============
const rooms = new Map();   // code -> Room
const clients = new Map(); // ws -> { roomCode, playerId, name }

function generateCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // 排除易混淆
  let code;
  do {
    code = '';
    for(let i=0;i<5;i++) code += chars[Math.floor(Math.random()*chars.length)];
  } while(rooms.has(code));
  return code;
}

function nextPlayerId(){
  return Math.random().toString(36).slice(2, 10);
}

function nowSec(){
  return Math.floor(Date.now() / 1000);
}

// ============ Room class ============
class Room {
  constructor(code, hostId, hostName, settings){
    this.code = code;
    this.hostId = hostId;
    this.settings = Object.assign({
      maxHumans: 6,
      aiCount: 0,
      baseTurnSec: 20,
      blindMs: 120000,
      mode: 'classic',
      level: 1,
    }, settings || {});
    this.game = new Game();
    this.game.blindMs = this.settings.blindMs;
    this.game.turnTimeoutMs = this.settings.baseTurnSec * 1000;
    this.game.baseTurnTimeoutMs = this.settings.baseTurnSec * 1000;
    this.game.mode = this.settings.mode || 'classic';
    this.game.level = this.settings.level || 1;
    this.powerPickState = null;  // { playerId, choices, deadline, timer }
    this._blindElapsedAtPause = 0;
    this.humanIds = new Map();   // playerId -> ws
    this.turnDeadline = 0;
    this.turnTimer = null;
    this.blindTimer = null;
    this.phase = 'lobby';        // 'lobby' | 'in-game' | 'between-hands' | 'showdown' | 'ended'
    this.lastAction = null;
    this.lastShowdown = null;
    this.spectators = new Set(); // ws set, 觀戰者（已淘汰真人）
    this.talents = new Map();    // playerId -> talentId（lobby 階段，AI 也用）
  }

  addHumanPlayer(playerId, name, avatar, ws){
    if(this.phase !== 'lobby'){
      // 遊戲中不允許新加（之後可加觀戰）
      return false;
    }
    if(this.game.players.length >= 6) return false;
    this.game.addPlayer({ id: playerId, name, avatar, isAI: false });
    this.humanIds.set(playerId, ws);
    return true;
  }

  fillAI(){
    const aiCount = Math.max(0, Math.min(6 - this.game.players.length, this.settings.aiCount));
    // AI 自動分配 robot 系列 emoji，依 index 輪替
    const AI_AVATARS = ['🤖','👾','🦾','⚙️','📟'];
    for(let i=0;i<aiCount;i++){
      const aiId = 'AI' + (i+1) + '_' + Math.random().toString(36).slice(2,5);
      const aiAvatar = AI_AVATARS[i % AI_AVATARS.length];
      this.game.addPlayer({ id: aiId, name: `CPU ${i+1}`, avatar: aiAvatar, isAI: true });
    }
  }

  // 把已選的 talent 套用，沒選的隨機指派（每位玩家不重複）
  assignTalents(){
    const used = new Set([...this.talents.values()].filter(Boolean));
    const pool = CHARACTERS.filter(c=> !used.has(c.id));
    // 洗牌 pool
    for(let i=pool.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [pool[i],pool[j]] = [pool[j],pool[i]];
    }
    this.game.players.forEach(p=>{
      let t = this.talents.get(p.id);
      if(!t){
        const pick = pool.shift();
        if(pick) t = pick.id;
        else t = CHARACTERS[Math.floor(Math.random()*CHARACTERS.length)].id;
        this.talents.set(p.id, t);
      }
      p.talent = t;
    });
  }

  removePlayer(playerId){
    if(this.phase === 'lobby'){
      // lobby 階段直接移除
      this.game.players = this.game.players.filter(p=> p.id !== playerId);
    } else {
      // 遊戲中：標記為棄牌 + 不再參與
      const p = this.game.players.find(x=> x.id === playerId);
      if(p && p.alive){
        p.folded = true;
        // 不立刻 alive=false，等本手結束自然處理
      }
    }
    this.humanIds.delete(playerId);
  }

  startGame(){
    if(this.phase !== 'lobby') return false;
    const totalAfter = this.game.players.length + this.settings.aiCount;
    if(totalAfter < 2) return false;
    this.fillAI();
    this.assignTalents();
    // 套用 mode / level
    this.game.mode = this.settings.mode || 'classic';
    this.game.level = this.settings.level || 1;
    this.game.start();
    this.phase = 'between-hands';
    this.broadcast({
      type:'game-started',
      talents: this.game.players.map(p=>({ id:p.id, name:p.name, isAI:p.isAI, talent:p.talent })),
      mode: this.game.mode,
      level: this.game.level,
      modeDetail: modeDetail(this.game.mode, this.game.level),
    });
    this._nextHand();
    this._startBlindTimer();
    return true;
  }

  _nextHand(){
    if(this.game.ended || this.phase === 'ended') return;
    // 觀戰模式：所有真人都掛了 → 不結束，繼續看
    const aliveHumans = this.game.players.filter(p=> !p.isAI && p.alive);
    const aliveTotal = this.game.players.filter(p=> p.alive).length;
    if(aliveTotal <= 1){
      this._endTournament();
      return;
    }

    // 上一手結束：如果有待升盲，先升然後跳提醒，再開新手
    const bu = this.game.applyPendingBlindUp();
    if(bu){
      this.broadcast({ type:'blind-up', level: bu.level, sb: bu.sb, bb: bu.bb });
      // 跳完提醒後再開新手（讓 client 看 2.5 秒）
      setTimeout(()=> this._startNewHand(), 2500);
      return;
    }
    this._startNewHand();
  }

  _startNewHand(){
    const ok = this.game.startHand();
    if(!ok){
      this._endTournament();
      return;
    }
    this.phase = 'in-game';
    this._broadcastState();
    // 開局產生的 triggers（east_money / last_straw 免費 BB）即時 broadcast
    const handStartTriggers = (this.game._triggers || []).slice();
    if(handStartTriggers.length){
      this.broadcast({ type:'triggers', triggers: handStartTriggers });
    }
    this._scheduleTurn();
  }

  _scheduleTurn(){
    if(this.turnTimer) clearTimeout(this.turnTimer);
    const cur = this.game.currentPlayer();
    if(!cur || !cur.alive || cur.folded || cur.allIn){
      this._afterAction();
      return;
    }
    this.turnDeadline = Date.now() + this.game.turnTimeoutMs;
    this._broadcastState();

    if(cur.isAI){
      // AI 思考一段時間然後行動
      const wait = 600 + Math.random() * 1500;
      this.turnTimer = setTimeout(()=>{
        const action = aiDecide(this.game, cur);
        this._handleAction(cur.id, action);
      }, wait);
    } else {
      // 真人：超時自動行動
      const ws = this.humanIds.get(cur.id);
      if(!ws){
        // 玩家斷線 → 自動 fold
        this.turnTimer = setTimeout(()=>{
          this._handleAction(cur.id, { type:'fold' });
        }, 200);
      } else {
        this.turnTimer = setTimeout(()=>{
          // 逾時自動：能 check 就 check，否則 fold
          const need = this.game.highestBet - cur.bet;
          this._handleAction(cur.id, { type: need===0 ? 'check' : 'fold' });
        }, this.game.turnTimeoutMs);
      }
    }
  }

  handleClientAction(playerId, action){
    const cur = this.game.currentPlayer();
    if(!cur || cur.id !== playerId){
      return { ok:false, error:'not your turn' };
    }
    return this._handleAction(playerId, action);
  }

  _handleAction(playerId, action){
    if(this.turnTimer){ clearTimeout(this.turnTimer); this.turnTimer = null; }
    // 記錄目前 triggers 數量；action 後新增的就是這次行動的觸發
    const beforeCnt = (this.game._triggers || []).length;
    const result = this.game.applyAction(playerId, action);
    if(!result.ok){
      // 不合法 → 跳回 schedule（這應該不會發生因為 server 會檢查）
      this._scheduleTurn();
      return result;
    }
    this.lastAction = { playerId, action, ts: Date.now() };
    this.broadcast({
      type:'action-result',
      playerId,
      action,
      pot: this.game.pot,
      players: this.game.players.map(p=>({ id:p.id, chips:p.chips, bet:p.bet, folded:p.folded, allIn:p.allIn })),
    });
    // 即時 broadcast 這次行動產生的 talent triggers（例如 氣勢凌人/水漲船高/精準出擊）
    const newTriggers = (this.game._triggers || []).slice(beforeCnt);
    if(newTriggers.length){
      this.broadcast({ type:'triggers', triggers: newTriggers });
    }
    this._afterAction();
    return { ok:true };
  }

  _afterAction(){
    const adv = this.game.advance();
    if(adv.phase === 'next-action'){
      this._scheduleTurn();
    } else if(adv.phase === 'next-street'){
      this.broadcast({ type:'street', street: adv.street, community: adv.community });
      // 等 1 秒讓 client 看到新的公牌
      setTimeout(()=> this._scheduleTurn(), 1000);
    } else if(adv.phase === 'auto-runout'){
      // All-in 後沒人能再下注 → 一張一張發 + 廣播，最後再 showdown
      // 先廣播一次 state 清掉「誰是當前 player」、停掉客戶端的計時環
      // 此刻 game.community 還沒被加新牌，所以 client 收到的是「目前該看到的公牌」
      this.turnDeadline = 0;
      this._broadcastState();
      const pending = adv.pendingStreets || [];
      let delay = 700;
      pending.forEach(streetName => {
        setTimeout(() => {
          // 真正在這一刻才發那條街的牌
          if(streetName === 'flop'){ this.game.street = 'flop'; this.game._dealFlop(); }
          else if(streetName === 'turn'){ this.game.street = 'turn'; this.game._dealTurn(); }
          else if(streetName === 'river'){ this.game.street = 'river'; this.game._dealRiver(); }
          this.broadcast({
            type:'street',
            street: streetName,
            community: this.game.community.slice(),
          });
        }, delay);
        delay += 1100;
      });
      setTimeout(() => this._doShowdown(), delay + 400);
    } else if(adv.phase === 'showdown'){
      this._doShowdown();
    }
  }

  _doShowdown(){
    this.phase = 'showdown';
    const beforeCnt = (this.game._triggers || []).length;
    const result = this.game.showdown();
    // 只 broadcast showdown 內產生的 triggers（先前 broadcast 過的不重複）
    result.triggers = (this.game._triggers || []).slice(beforeCnt);
    this.lastShowdown = result;
    this.broadcast({
      type:'showdown',
      result,
      players: this.game.players.map(p=>({ id:p.id, chips:p.chips, alive:p.alive })),
    });
    // 等 7.5 秒（client 顯示動畫 + 觸發 toast）後處理能力選擇 / 開新一手
    setTimeout(()=>{
      this.phase = 'between-hands';
      // 有人被淘汰 → 給 killer 選一個能力
      if(result.killer && (result.eliminated || []).length){
        this._startPowerPick(result.killer, result.eliminated);
      } else {
        this._nextHand();
      }
    }, 7500);
  }

  _startPowerPick(killerId, eliminated){
    const killer = this.game.players.find(p=> p.id === killerId);
    if(!killer || !killer.alive){
      this._nextHand();
      return;
    }
    const choices = this.game.rollPowerChoices(killerId, 3);
    if(!choices.length){
      this._nextHand();
      return;
    }
    const deadline = Date.now() + 30000;
    this.powerPickState = { playerId: killerId, choices, deadline, timer: null };
    // 暫停升盲計時器（紀錄已過時間）
    if(this.blindTimer){ clearInterval(this.blindTimer); this.blindTimer = null; }
    this._blindElapsedAtPause = Date.now() - this.game.blindStartTs;

    // AI 直接秒選
    if(killer.isAI){
      const pick = choices[Math.floor(Math.random()*choices.length)];
      setTimeout(()=> this._finishPowerPick(pick.id), 800);
      this.broadcast({ type:'power-pick-pending', killerId, killerName:killer.name, eliminated, deadline, isAI:true });
      return;
    }

    // 真人：發 choose-power 給 killer，廣播 pending 給其他人
    const ws = this.humanIds.get(killerId);
    if(ws){
      send(ws, { type:'choose-power', choices, deadline });
    }
    this.broadcast({ type:'power-pick-pending', killerId, killerName:killer.name, eliminated, deadline, isAI:false });

    // 30 秒沒選 → 隨機
    this.powerPickState.timer = setTimeout(()=>{
      const pick = choices[Math.floor(Math.random()*choices.length)];
      this._finishPowerPick(pick.id);
    }, 30000);
  }

  _finishPowerPick(powerId){
    if(!this.powerPickState) return;
    const { playerId, timer } = this.powerPickState;
    if(timer) clearTimeout(timer);
    this.game.awardPower(playerId, powerId);
    const player = this.game.players.find(p=> p.id === playerId);
    const power = POWER_UPS.find(p=> p.id === powerId);
    this.broadcast({
      type:'power-applied',
      playerId,
      playerName: player ? player.name : '',
      powerId,
      power: power || null,
    });
    this.powerPickState = null;
    // 恢復升盲計時器
    if(this._blindElapsedAtPause){
      this.game.blindStartTs = Date.now() - this._blindElapsedAtPause;
      this._blindElapsedAtPause = 0;
    }
    this._startBlindTimer();
    // 等 2 秒讓大家看 power-applied 然後開新一手
    setTimeout(()=> this._nextHand(), 2000);
  }

  _startBlindTimer(){
    if(this.blindTimer) clearInterval(this.blindTimer);
    this.blindTimer = setInterval(()=>{
      if(this.game.ended || this.phase === 'ended'){
        clearInterval(this.blindTimer);
        return;
      }
      this.game.tickBlind();   // 只設 pending，不立刻升
      this.broadcast({ type:'blind-tick', msLeft: this.game.blindMsLeft(), pending: !!this.game.pendingBlindUp });
    }, 5000);
  }

  _endTournament(){
    if(this.phase === 'ended') return;
    this.phase = 'ended';
    this.game.ended = true;
    if(this.turnTimer) clearTimeout(this.turnTimer);
    if(this.blindTimer) clearInterval(this.blindTimer);
    this.broadcast({
      type:'tournament-end',
      rankings: this.game.rankings(),
      handNum: this.game.handNum,
    });
  }

  broadcast(msg){
    const json = JSON.stringify(msg);
    this.humanIds.forEach((ws, pid)=>{
      if(ws.readyState === ws.OPEN) ws.send(json);
    });
    this.spectators.forEach(ws=>{
      if(ws.readyState === ws.OPEN) ws.send(json);
    });
  }

  _broadcastState(){
    const cur = this.game.currentPlayer();
    const turnDeadline = this.turnDeadline;
    this.humanIds.forEach((ws, pid)=>{
      if(ws.readyState !== ws.OPEN) return;
      const state = this.game.publicState(pid);
      const payload = {
        type:'game-state',
        state,
        yourId: pid,
        currentPlayerId: cur?.id ?? null,
        turnDeadline,
      };
      if(cur && cur.id === pid){
        payload.yourTurn = {
          validActions: this.game.validActions(cur),
          need: Math.max(0, this.game.highestBet - cur.bet),
          minRaiseTo: this.game.highestBet + this.game.minRaise,
          maxRaiseTo: cur.bet + cur.chips,
          deadline: turnDeadline,
        };
      }
      ws.send(JSON.stringify(payload));
    });
    // 觀戰者拿不到任何人的底牌
    this.spectators.forEach(ws=>{
      if(ws.readyState !== ws.OPEN) return;
      const state = this.game.publicState(null);
      ws.send(JSON.stringify({ type:'game-state', state, currentPlayerId: cur?.id ?? null, spectator:true }));
    });
  }

  publicLobbyInfo(){
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      players: this.game.players.map(p=>({
        id:p.id, name:p.name, isAI:p.isAI,
        avatar: p.avatar || (p.isAI ? '🤖' : '🧑'),
        talent: this.talents.get(p.id) || null,
      })),
      settings: this.settings,
      modeDetail: modeDetail(this.settings.mode || 'classic', this.settings.level || 1),
    };
  }
}

// ============ WebSocket 訊息處理 ============

function send(ws, msg){
  if(ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws)=>{
  ws.on('message', (raw)=>{
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch(e){ return; }
    handleMessage(ws, msg);
  });
  ws.on('close', ()=>{
    handleDisconnect(ws);
  });
  ws.on('error', ()=>{
    try { ws.close(); } catch(e){}
  });
});

function handleMessage(ws, msg){
  const c = clients.get(ws);
  switch(msg.type){
    case 'create-room': {
      const code = generateCode();
      const playerId = nextPlayerId();
      const room = new Room(code, playerId, msg.name || '玩家', msg.settings);
      const ok = room.addHumanPlayer(playerId, msg.name || '玩家', msg.avatar || '🧑', ws);
      if(!ok){ send(ws, { type:'error', msg:'create failed' }); return; }
      rooms.set(code, room);
      clients.set(ws, { roomCode: code, playerId, name: msg.name });
      send(ws, { type:'room-created', code, playerId, lobby: room.publicLobbyInfo() });
      break;
    }
    case 'join-room': {
      const room = rooms.get((msg.code||'').toUpperCase());
      if(!room){ send(ws, { type:'error', msg:'room not found' }); return; }
      if(room.phase !== 'lobby'){
        // 加入觀戰
        room.spectators.add(ws);
        clients.set(ws, { roomCode: room.code, playerId: null, name: msg.name, spectator:true });
        send(ws, { type:'spectator-joined', code: room.code, lobby: room.publicLobbyInfo() });
        room._broadcastState();
        return;
      }
      const playerId = nextPlayerId();
      const ok = room.addHumanPlayer(playerId, msg.name || '玩家', msg.avatar || '🧑', ws);
      if(!ok){ send(ws, { type:'error', msg:'room full' }); return; }
      clients.set(ws, { roomCode: room.code, playerId, name: msg.name });
      send(ws, { type:'room-joined', code: room.code, playerId, lobby: room.publicLobbyInfo() });
      // 通知房內所有人
      room.humanIds.forEach((w)=> send(w, { type:'lobby-update', lobby: room.publicLobbyInfo() }));
      break;
    }
    case 'update-settings': {
      if(!c) return;
      const room = rooms.get(c.roomCode);
      if(!room || room.hostId !== c.playerId) return;
      Object.assign(room.settings, msg.settings || {});
      if(typeof room.settings.baseTurnSec === 'number'){
        room.game.turnTimeoutMs = room.settings.baseTurnSec * 1000;
        room.game.baseTurnTimeoutMs = room.settings.baseTurnSec * 1000;
      }
      if(typeof room.settings.blindMs === 'number'){
        room.game.blindMs = room.settings.blindMs;
      }
      if(typeof room.settings.mode === 'string') room.game.mode = room.settings.mode;
      if(typeof room.settings.level === 'number') room.game.level = room.settings.level;
      room.humanIds.forEach((w)=> send(w, { type:'lobby-update', lobby: room.publicLobbyInfo() }));
      break;
    }
    case 'select-power': {
      if(!c) return;
      const room = rooms.get(c.roomCode);
      if(!room || !room.powerPickState) return;
      if(room.powerPickState.playerId !== c.playerId) return;
      const pid = (msg.powerId || '').toString();
      const valid = room.powerPickState.choices.find(x=> x.id === pid);
      if(!valid) return;
      room._finishPowerPick(pid);
      break;
    }
    case 'select-talent': {
      if(!c) return;
      const room = rooms.get(c.roomCode);
      if(!room || room.phase !== 'lobby') return;
      const tid = msg.talentId || null;
      // 取消選取
      if(!tid){
        room.talents.delete(c.playerId);
      } else {
        // 檢查是否被其他人佔用
        for(const [pid, t] of room.talents.entries()){
          if(pid !== c.playerId && t === tid){
            send(ws, { type:'error', msg:'這個角色已被其他人選了' });
            return;
          }
        }
        room.talents.set(c.playerId, tid);
      }
      room.humanIds.forEach((w)=> send(w, { type:'lobby-update', lobby: room.publicLobbyInfo() }));
      break;
    }
    case 'start-game': {
      if(!c) return;
      const room = rooms.get(c.roomCode);
      if(!room) return;
      if(room.hostId !== c.playerId){
        send(ws, { type:'error', msg:'only host can start' });
        return;
      }
      const ok = room.startGame();
      if(!ok) send(ws, { type:'error', msg:'cannot start (need ≥ 2 players)' });
      break;
    }
    case 'action': {
      if(!c) return;
      const room = rooms.get(c.roomCode);
      if(!room) return;
      const r = room.handleClientAction(c.playerId, msg.action);
      if(!r.ok) send(ws, { type:'error', msg: r.error });
      break;
    }
    case 'leave-room': {
      handleDisconnect(ws);
      try { ws.close(); } catch(e){}
      break;
    }
    case 'ping': {
      send(ws, { type:'pong', t: Date.now() });
      break;
    }
  }
}

function handleDisconnect(ws){
  const c = clients.get(ws);
  if(!c) return;
  const room = rooms.get(c.roomCode);
  if(room){
    if(c.spectator){
      room.spectators.delete(ws);
    } else {
      room.removePlayer(c.playerId);
      // 通知房內其他人
      room.humanIds.forEach((w)=> send(w, { type:'lobby-update', lobby: room.publicLobbyInfo() }));
      // 如果房間沒人 → 移除
      if(room.humanIds.size === 0){
        if(room.turnTimer) clearTimeout(room.turnTimer);
        if(room.blindTimer) clearInterval(room.blindTimer);
        rooms.delete(c.roomCode);
      }
    }
  }
  clients.delete(ws);
}

// ============ 啟動 ============
server.listen(PORT, ()=>{
  console.log(`Poker server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play locally`);
});
