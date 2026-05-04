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
const { Game, aiDecide } = require('./game-engine');

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
    }, settings || {});
    this.game = new Game();
    this.game.blindMs = this.settings.blindMs;
    this.game.turnTimeoutMs = this.settings.baseTurnSec * 1000;
    this.humanIds = new Map();   // playerId -> ws
    this.turnDeadline = 0;
    this.turnTimer = null;
    this.blindTimer = null;
    this.phase = 'lobby';        // 'lobby' | 'in-game' | 'between-hands' | 'showdown' | 'ended'
    this.lastAction = null;
    this.lastShowdown = null;
    this.spectators = new Set(); // ws set, 觀戰者（已淘汰真人）
  }

  addHumanPlayer(playerId, name, ws){
    if(this.phase !== 'lobby'){
      // 遊戲中不允許新加（之後可加觀戰）
      return false;
    }
    if(this.game.players.length >= 6) return false;
    this.game.addPlayer({ id: playerId, name, isAI: false });
    this.humanIds.set(playerId, ws);
    return true;
  }

  fillAI(){
    const aiCount = Math.max(0, Math.min(6 - this.game.players.length, this.settings.aiCount));
    for(let i=0;i<aiCount;i++){
      const aiId = 'AI' + (i+1) + '_' + Math.random().toString(36).slice(2,5);
      this.game.addPlayer({ id: aiId, name: `CPU ${i+1}`, isAI: true });
    }
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
    this.game.start();
    this.phase = 'between-hands';
    this.broadcast({ type:'game-started' });
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
    const ok = this.game.startHand();
    if(!ok){
      this._endTournament();
      return;
    }
    this.phase = 'in-game';
    this._broadcastState();
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
    } else if(adv.phase === 'showdown'){
      this._doShowdown();
    }
  }

  _doShowdown(){
    this.phase = 'showdown';
    const result = this.game.showdown();
    this.lastShowdown = result;
    this.broadcast({
      type:'showdown',
      result,
      players: this.game.players.map(p=>({ id:p.id, chips:p.chips, alive:p.alive })),
    });
    // 等 6 秒（client 顯示動畫）後開新一手
    setTimeout(()=>{
      this.phase = 'between-hands';
      this._nextHand();
    }, 6000);
  }

  _startBlindTimer(){
    if(this.blindTimer) clearInterval(this.blindTimer);
    this.blindTimer = setInterval(()=>{
      if(this.game.ended || this.phase === 'ended'){
        clearInterval(this.blindTimer);
        return;
      }
      const up = this.game.tickBlind();
      if(up){
        this.broadcast({ type:'blind-up', level: up.level, sb: up.sb, bb: up.bb });
      }
      // 也 broadcast 倒數（每 5 秒）
      this.broadcast({ type:'blind-tick', msLeft: this.game.blindMsLeft() });
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
      players: this.game.players.map(p=>({ id:p.id, name:p.name, isAI:p.isAI })),
      settings: this.settings,
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
      const ok = room.addHumanPlayer(playerId, msg.name || '玩家', ws);
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
      const ok = room.addHumanPlayer(playerId, msg.name || '玩家', ws);
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
      }
      if(typeof room.settings.blindMs === 'number'){
        room.game.blindMs = room.settings.blindMs;
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
