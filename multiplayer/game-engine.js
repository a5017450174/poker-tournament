/* =========================================================================
   德撲錦標賽 — 遊戲邏輯引擎（server 端使用）
   經典模式：52 張、標準牌型大小、6 人桌
   ========================================================================= */

const SUITS = ['s','h','d','c'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_VAL = Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));
const HAND_TYPES = ['高牌','一對','兩對','三條','順子','同花','葫蘆','鐵支','同花順','皇家同花順'];

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function buildDeck(){
  const d = [];
  for(const r of RANKS) for(const s of SUITS) d.push({ rank:r, suit:s, key:r+s });
  return d;
}

function score5(five, validRanks){
  const vals = five.map(c=>RANK_VAL[c.rank]).sort((a,b)=>b-a);
  const suits = five.map(c=>c.suit);
  const rcount = {};
  for(const v of vals) rcount[v] = (rcount[v]||0)+1;
  const groups = Object.entries(rcount).map(([v,c])=>({v:+v,c})).sort((a,b)=> b.c-a.c || b.v-a.v);
  const isFlush = suits.every(s=>s===suits[0]);
  let straight = false, straightHigh = 0;
  let consec = true;
  for(let i=0;i<4;i++){
    if(vals[i]-vals[i+1] !== 1){ consec = false; break; }
  }
  if(consec){ straight = true; straightHigh = vals[0]; }
  // wheel
  if(!straight && vals[0]===14){
    const presentVals = [...validRanks].map(r=>RANK_VAL[r]).sort((a,b)=>a-b);
    const lowest4 = presentVals.slice(0,4);
    const tail = vals.slice(1).slice().sort((a,b)=>a-b);
    if(lowest4.length===4 && tail.length===4 && lowest4.every((v,i)=>v===tail[i])){
      let l4ok = true;
      for(let i=0;i<3;i++) if(lowest4[i+1]-lowest4[i]!==1){ l4ok=false; break; }
      if(l4ok){ straight = true; straightHigh = lowest4[3]; }
    }
  }
  if(straight && isFlush){
    if(straightHigh===14) return [9, 14];
    return [8, straightHigh];
  }
  if(groups[0].c===4) return [7, groups[0].v, groups[1].v];
  if(groups[0].c===3 && groups[1].c===2) return [6, groups[0].v, groups[1].v];
  if(isFlush) return [5, ...vals];
  if(straight) return [4, straightHigh];
  if(groups[0].c===3) return [3, groups[0].v, ...vals.filter(v=>v!==groups[0].v)];
  if(groups[0].c===2 && groups[1].c===2){
    const top = Math.max(groups[0].v, groups[1].v);
    const low = Math.min(groups[0].v, groups[1].v);
    const kicker = vals.filter(v=>v!==groups[0].v && v!==groups[1].v)[0];
    return [2, top, low, kicker];
  }
  if(groups[0].c===2) return [1, groups[0].v, ...vals.filter(v=>v!==groups[0].v)];
  return [0, ...vals];
}

function cmpScore(a, b){
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const x = a[i]||0, y = b[i]||0;
    if(x!==y) return x-y;
  }
  return 0;
}

function evaluate7(cards, validRanks){
  const combos = [];
  for(let a=0;a<3;a++) for(let b=a+1;b<4;b++)
    for(let c=b+1;c<5;c++) for(let d=c+1;d<6;d++)
      for(let e=d+1;e<7;e++) combos.push([a,b,c,d,e]);
  let best = null;
  for(const cb of combos){
    const five = cb.map(i=>cards[i]);
    const sc = score5(five, validRanks);
    if(!best || cmpScore(sc, best.score)>0){
      best = { score: sc, cards: five };
    }
  }
  return best;
}

function pickMatchedCards(fiveCards, type){
  const counts = {};
  fiveCards.forEach(c => counts[c.rank] = (counts[c.rank]||0)+1);
  switch(type){
    case 0: return [fiveCards.slice().sort((a,b)=>RANK_VAL[b.rank]-RANK_VAL[a.rank])[0]];
    case 1: return fiveCards.filter(c=> counts[c.rank]===2);
    case 2: return fiveCards.filter(c=> counts[c.rank]===2);
    case 3: return fiveCards.filter(c=> counts[c.rank]===3);
    case 7: return fiveCards.filter(c=> counts[c.rank]===4);
    default: return fiveCards;
  }
}

function bestFiveCardHand(cards, validRanks){
  const n = cards.length;
  let best = null;
  function gen(start, picked){
    if(picked.length === 5){
      const sc = score5(picked, validRanks);
      if(!best || cmpScore(sc, best.score) > 0){
        best = { score: sc.slice(), cards: picked.slice() };
      }
      return;
    }
    for(let i=start; i<n; i++){
      if(n - i < 5 - picked.length) return;
      picked.push(cards[i]);
      gen(i+1, picked);
      picked.pop();
    }
  }
  gen(0, []);
  if(!best) return null;
  const type = best.score[0];
  const matched = pickMatchedCards(best.cards, type);
  let name = HAND_TYPES[type];
  if(type===1 || type===3 || type===7){
    const counts = {};
    best.cards.forEach(c=> counts[c.rank] = (counts[c.rank]||0)+1);
    const target = type===1?2 : type===3?3 : 4;
    const r = Object.keys(counts).find(k=> counts[k]===target);
    if(r) name += ` ${r==='T'?'10':r}`;
  }
  return { type, name, cards: matched, score: best.score };
}

/* =========================================================================
   Game class — 一個房間 = 一個 Game instance
   ========================================================================= */

class Game {
  constructor(opts={}){
    this.players = [];           // { id, name, isAI, chips, hole, alive, folded, allIn, bet, totalBet, eliminatedAtHand }
    this.community = [];
    this.deck = [];
    this.validRanks = new Set(RANKS);
    this.pot = 0;
    this.dealerPos = 0;
    this.currentPos = 0;
    this.street = 'preflop';
    this.handNum = 0;
    this.blindLevel = 1;
    this.sb = 100;
    this.bb = 200;
    this.blindMs = 120000;
    this.blindStartTs = 0;
    this.startTs = 0;
    this.highestBet = 0;
    this.lastRaiseAmt = 0;
    this.minRaise = 200;
    this.toAct = new Set();
    this.hasActedThisRound = new Set();
    this.sbPos = -1;
    this.bbPos = -1;
    this.turnTimeoutMs = 20000;  // 預設 20 秒
    this.started = false;
    this.ended = false;
    this.lastWinnerId = null;
    this.log = [];
  }

  addPlayer(p){
    this.players.push({
      id: p.id,
      name: p.name,
      isAI: !!p.isAI,
      chips: p.chips || 10000,
      hole: [],
      alive: true,
      folded: false,
      allIn: false,
      bet: 0,
      totalBet: 0,
      eliminatedAtHand: null,
    });
  }

  addLog(msg){
    this.log.push({ t: Date.now(), msg });
    if(this.log.length > 200) this.log.shift();
  }

  start(){
    if(this.started) return;
    this.started = true;
    this.dealerPos = Math.floor(Math.random() * this.players.length);
    this.handNum = 0;
    this.blindLevel = 1;
    this.sb = 100;
    this.bb = 200;
    this.startTs = Date.now();
    this.blindStartTs = Date.now();
  }

  // 升盲檢查（外部 server tick 呼叫，回傳是否升盲）
  tickBlind(){
    if(!this.started || this.ended) return null;
    const elapsed = Date.now() - this.blindStartTs;
    if(elapsed >= this.blindMs){
      this.blindLevel++;
      this.sb *= 2;
      this.bb *= 2;
      this.blindStartTs = Date.now();
      this.addLog(`▲ 升盲：${this.sb}/${this.bb}`);
      return { level: this.blindLevel, sb: this.sb, bb: this.bb };
    }
    return null;
  }

  blindMsLeft(){
    if(!this.started || this.ended) return this.blindMs;
    return Math.max(0, this.blindMs - (Date.now() - this.blindStartTs));
  }

  startHand(){
    // 移除已輸光的人
    this.players.forEach(p=>{
      if(p.alive && p.chips <= 0){
        p.alive = false;
        p.eliminatedAtHand = this.handNum;
        this.addLog(`✘ ${p.name} 出局`);
      }
    });
    const aliveCount = this.players.filter(p=>p.alive).length;
    if(aliveCount <= 1){
      this.ended = true;
      return false;
    }
    this.handNum++;
    this.players.forEach(p=>{
      p.hole = [];
      p.folded = false;
      p.allIn = false;
      p.bet = 0;
      p.totalBet = 0;
    });
    this.community = [];
    this.pot = 0;
    this.street = 'preflop';
    this.highestBet = 0;
    this.lastRaiseAmt = this.bb;
    this.minRaise = this.bb;

    // dealer 推到下一個還活著的人
    do { this.dealerPos = (this.dealerPos + 1) % this.players.length; }
    while(!this.players[this.dealerPos].alive);

    // 重建並洗牌
    this.deck = buildDeck();
    shuffle(this.deck);
    this.validRanks = new Set(RANKS);

    // 找 SB / BB / UTG
    const N = this.players.length;
    const alivePos = [];
    for(let i=0;i<N;i++){
      const idx = (this.dealerPos + 1 + i) % N;
      if(this.players[idx].alive) alivePos.push(idx);
    }
    let sbPos, bbPos, utgPos;
    if(alivePos.length === 2){
      sbPos = this.dealerPos;
      bbPos = alivePos.find(p=> p !== this.dealerPos);
      utgPos = sbPos;
    } else {
      sbPos = alivePos[0];
      bbPos = alivePos[1];
      utgPos = alivePos[2 % alivePos.length];
    }
    this.sbPos = sbPos;
    this.bbPos = bbPos;
    this._postBlind(this.players[sbPos], this.sb, 'SB');
    this._postBlind(this.players[bbPos], this.bb, 'BB');
    this.highestBet = this.bb;

    // 發底牌
    for(let r=0;r<2;r++){
      for(const idx of alivePos){
        this.players[idx].hole.push(this.deck.pop());
      }
    }

    this.toAct = new Set(alivePos.map(i => this.players[i].id));
    this.hasActedThisRound = new Set();
    this.currentPos = utgPos;

    return true;
  }

  _postBlind(p, amt, label){
    const pay = Math.min(amt, p.chips);
    p.chips -= pay;
    p.bet = pay;
    p.totalBet = pay;
    this.pot += pay;
    if(p.chips === 0) p.allIn = true;
    this.addLog(`${p.name} 下 ${label} ${pay}`);
  }

  // 取得當前該行動的 player（活著、沒棄牌、沒 all-in、還沒這條街行動完）
  currentPlayer(){
    return this.players[this.currentPos];
  }

  validActions(player){
    if(!player.alive || player.folded || player.allIn) return [];
    const need = this.highestBet - player.bet;
    const actions = ['fold'];
    if(need === 0) actions.push('check');
    if(need > 0 && player.chips > 0) actions.push('call');
    const maxRaiseTarget = player.bet + player.chips;
    if(player.chips > 0 && maxRaiseTarget > this.highestBet) actions.push('raise');
    if(player.chips > 0) actions.push('allin');
    return actions;
  }

  // 套用行動，回傳 { ok, error?, result }
  applyAction(playerId, action){
    if(this.ended) return { ok:false, error:'game ended' };
    const p = this.players.find(x=> x.id === playerId);
    if(!p) return { ok:false, error:'player not found' };
    if(this.players[this.currentPos].id !== playerId){
      return { ok:false, error:'not your turn' };
    }
    if(!p.alive || p.folded || p.allIn){
      return { ok:false, error:'cannot act' };
    }
    const need = this.highestBet - p.bet;

    if(action.type === 'fold'){
      p.folded = true;
      this.addLog(`${p.name} 棄牌`);
    } else if(action.type === 'check'){
      if(need !== 0) return { ok:false, error:'cannot check, must call or fold' };
      this.addLog(`${p.name} 過牌`);
    } else if(action.type === 'call'){
      const pay = Math.min(need, p.chips);
      p.chips -= pay;
      p.bet += pay;
      p.totalBet += pay;
      this.pot += pay;
      if(p.chips === 0) p.allIn = true;
      this.addLog(`${p.name} 跟注 ${pay}`);
    } else if(action.type === 'raise' || action.type === 'allin'){
      let target;
      if(action.type === 'allin'){
        target = p.bet + p.chips;
      } else {
        target = action.amount || (this.highestBet + this.minRaise);
      }
      target = Math.max(target, this.highestBet + this.minRaise);
      target = Math.min(target, p.bet + p.chips);
      const pay = target - p.bet;
      if(pay <= 0) return { ok:false, error:'invalid raise' };
      p.chips -= pay;
      p.bet = target;
      p.totalBet += pay;
      this.pot += pay;
      if(p.chips === 0) p.allIn = true;
      if(target > this.highestBet){
        this.lastRaiseAmt = target - this.highestBet;
        this.minRaise = this.lastRaiseAmt;
        this.highestBet = target;
        // 別人需要再次行動
        this.players.forEach(other=>{
          if(other.alive && !other.folded && !other.allIn && other.id !== p.id){
            this.hasActedThisRound.delete(other.id);
          }
        });
      }
      this.addLog(`${p.name} ${action.type==='allin'?'All-in':'加注到'} ${target}`);
    } else {
      return { ok:false, error:'unknown action' };
    }

    this.hasActedThisRound.add(p.id);
    return { ok:true };
  }

  // 推進回合：回傳 { phase: 'next-action'|'next-street'|'showdown', currentId? }
  advance(){
    const remaining = this.players.filter(p=> p.alive && !p.folded);
    if(remaining.length <= 1){
      return { phase: 'showdown' };
    }
    if(this._roundComplete()){
      return this._nextStreet();
    }
    // 找下一個能行動的人
    const N = this.players.length;
    let next = (this.currentPos + 1) % N;
    let safety = N + 1;
    while(safety-- > 0){
      const p = this.players[next];
      if(p.alive && !p.folded && !p.allIn && this.toAct.has(p.id) && !this.hasActedThisRound.has(p.id)){
        this.currentPos = next;
        return { phase: 'next-action', currentId: p.id };
      }
      next = (next + 1) % N;
    }
    // 沒人可以動了 → 進下一條街
    return this._nextStreet();
  }

  _roundComplete(){
    const active = this.players.filter(p=> p.alive && !p.folded && !p.allIn);
    if(active.length === 0) return true;
    return active.every(p => p.bet === this.highestBet && this.hasActedThisRound.has(p.id));
  }

  _nextStreet(){
    // 結算這條街的 bet
    this.players.forEach(p => { p.bet = 0; });
    const remaining = this.players.filter(p=> p.alive && !p.folded);
    if(remaining.length <= 1){
      return { phase: 'showdown' };
    }
    if(this.street === 'preflop'){ this.street = 'flop'; this._dealFlop(); }
    else if(this.street === 'flop'){ this.street = 'turn'; this._dealTurn(); }
    else if(this.street === 'turn'){ this.street = 'river'; this._dealRiver(); }
    else { return { phase: 'showdown' }; }

    // 重設 toAct
    this.toAct = new Set(
      this.players.filter(p=> p.alive && !p.folded && !p.allIn).map(p=>p.id)
    );
    this.hasActedThisRound = new Set();
    this.highestBet = 0;
    this.lastRaiseAmt = this.bb;
    this.minRaise = this.bb;

    // 從 dealer 左邊第一個能動的人開始
    const N = this.players.length;
    let next = (this.dealerPos + 1) % N;
    let safety = N + 1;
    while(safety-- > 0){
      if(this.toAct.has(this.players[next].id)){ break; }
      next = (next + 1) % N;
    }
    this.currentPos = next;
    return { phase: 'next-street', street: this.street, community: this.community.slice(), currentId: this.players[next].id };
  }

  _dealFlop(){
    this.deck.pop();  // burn
    for(let i=0;i<3;i++) this.community.push(this.deck.pop());
    this.addLog(`◇ Flop: ${this.community.map(c=>c.rank+c.suit).join(' ')}`);
  }
  _dealTurn(){
    this.deck.pop();
    this.community.push(this.deck.pop());
    this.addLog(`◇ Turn: ${this.community.map(c=>c.rank+c.suit).join(' ')}`);
  }
  _dealRiver(){
    this.deck.pop();
    this.community.push(this.deck.pop());
    this.addLog(`◇ River: ${this.community.map(c=>c.rank+c.suit).join(' ')}`);
  }

  // 比牌結算 → 回傳 { winners, losers, handType, handName, matchedKeys, evals?, foldOut }
  showdown(){
    const remaining = this.players.filter(p=> p.alive && !p.folded);
    const potSnapshot = this.pot;
    if(remaining.length === 1){
      const w = remaining[0];
      w.chips += potSnapshot;
      this.pot = 0;
      this.lastWinnerId = w.id;
      this.addLog(`${w.name} 贏下底池 ${potSnapshot}（其他人都棄牌）`);
      return {
        winners: [w.id],
        losers: [],
        potWon: potSnapshot,
        foldOut: true,
      };
    }
    const evals = remaining.map(p=>{
      const ev = evaluate7(p.hole.concat(this.community), this.validRanks);
      return { p, ev };
    });
    let best = evals[0].ev.score;
    for(const e of evals) if(cmpScore(e.ev.score, best) > 0) best = e.ev.score;
    const winners = evals.filter(e=> cmpScore(e.ev.score, best) === 0).map(e=> e.p);
    const losers = evals.filter(e=> !winners.includes(e.p)).map(e=> e.p);

    // 算贏家最佳 5 張的 matched keys
    const sdKeys = [];
    let handName = HAND_TYPES[best[0]];
    winners.forEach(w=>{
      const all = w.hole.concat(this.community);
      const result = bestFiveCardHand(all, this.validRanks);
      if(result){
        result.cards.forEach(c=> sdKeys.push(c.key));
        if(result.name) handName = result.name;
      }
    });

    // 平分底池
    const share = Math.floor(potSnapshot / winners.length);
    const remain = potSnapshot - share * winners.length;
    winners.forEach(w=> w.chips += share);
    if(remain > 0) winners[0].chips += remain;
    this.pot = 0;
    this.lastWinnerId = winners[0]?.id ?? null;
    this.addLog(`★ ${winners.map(w=>w.name).join('、')} 贏下底池 ${potSnapshot}（${handName}）`);

    return {
      winners: winners.map(w=>w.id),
      losers: losers.map(l=>l.id),
      handType: best[0],
      handName,
      matchedKeys: sdKeys,
      reveals: remaining.reduce((acc,p)=>{ acc[p.id] = p.hole; return acc; }, {}),
      potWon: potSnapshot,
      foldOut: false,
    };
  }

  // 結束後排名
  rankings(){
    const sorted = this.players.slice().sort((a,b)=>{
      if(a.alive && !b.alive) return -1;
      if(!a.alive && b.alive) return 1;
      if(!a.alive && !b.alive) return (b.eliminatedAtHand||0) - (a.eliminatedAtHand||0);
      return b.chips - a.chips;
    });
    return sorted.map((p,i)=> ({
      rank: i+1,
      id: p.id,
      name: p.name,
      chips: p.chips,
      alive: p.alive,
      eliminatedAtHand: p.eliminatedAtHand,
    }));
  }

  // 回傳給特定玩家的 game state（隱藏其他人的底牌）
  publicState(forPlayerId=null){
    return {
      handNum: this.handNum,
      blindLevel: this.blindLevel,
      sb: this.sb,
      bb: this.bb,
      blindMsLeft: this.blindMsLeft(),
      pot: this.pot,
      community: this.community.slice(),
      street: this.street,
      currentPlayerId: this.players[this.currentPos]?.id ?? null,
      dealerPos: this.dealerPos,
      sbPos: this.sbPos,
      bbPos: this.bbPos,
      highestBet: this.highestBet,
      minRaise: this.minRaise,
      players: this.players.map(p=>({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        chips: p.chips,
        bet: p.bet,
        totalBet: p.totalBet,
        alive: p.alive,
        folded: p.folded,
        allIn: p.allIn,
        // 只給自己的底牌；其他人只說有沒有牌
        hole: (forPlayerId !== null && p.id === forPlayerId) ? p.hole : null,
        hasHole: p.hole.length > 0,
      })),
      ended: this.ended,
    };
  }
}

/* =========================================================================
   AI 邏輯（從原 HTML 移植）
   ========================================================================= */

function aiEstimateWinrate(game, p, samples=150){
  const opponents = game.players.filter(x=> x.alive && !x.folded && x.id !== p.id).length;
  if(opponents === 0) return 1;
  const known = new Set([...p.hole, ...game.community].map(c=>c.key));
  let wins = 0, ties = 0;
  for(let i=0;i<samples;i++){
    const remain = buildDeck().filter(c => !known.has(c.key));
    shuffle(remain);
    const need = (5 - game.community.length) + opponents * 2;
    const draws = remain.slice(0, need);
    const comm = game.community.concat(draws.slice(0, 5 - game.community.length));
    const oppCards = draws.slice(5 - game.community.length);
    const myEv = evaluate7(p.hole.concat(comm), game.validRanks);
    let best = myEv.score;
    let tied = false;
    for(let o=0;o<opponents;o++){
      const oh = oppCards.slice(o*2, o*2+2);
      const oe = evaluate7(oh.concat(comm), game.validRanks);
      const cmp = cmpScore(oe.score, best);
      if(cmp > 0){ best = oe.score; tied = false; break; }
      if(cmp === 0) tied = true;
    }
    if(cmpScore(myEv.score, best) === 0){
      if(tied) ties++; else wins++;
    }
  }
  return (wins + ties * 0.5) / samples;
}

function aiDecide(game, p){
  const need = game.highestBet - p.bet;
  const winrate = aiEstimateWinrate(game, p, 150);
  const potOdds = need === 0 ? 0 : need / (game.pot + need);
  const aggression = 0.55 + (Math.random() - 0.5) * 0.2;
  const stackBB = p.chips / Math.max(1, game.bb);

  // 短碼 push/fold
  if(stackBB < 12){
    if(winrate > 0.45) return { type: 'allin' };
    if(need === 0) return { type: 'check' };
    if(potOdds < winrate * 0.85) return { type: 'call' };
    return { type: 'fold' };
  }

  if(game.street === 'preflop'){
    if(winrate > 0.65 && Math.random() < aggression){
      const target = Math.min(p.bet + p.chips, game.highestBet * (2 + Math.random() * 1.5) + game.bb * 2);
      return { type: 'raise', amount: Math.floor(target) };
    }
    if(winrate > 0.40 || potOdds < winrate){
      if(need === 0) return { type: 'check' };
      return { type: 'call' };
    }
    if(need === 0) return { type: 'check' };
    return { type: 'fold' };
  }

  // flop+
  const bluff = Math.random() < 0.12;
  if(winrate > 0.70 && Math.random() < aggression){
    const sz = game.pot * (0.5 + Math.random() * 0.7);
    return { type: 'raise', amount: Math.floor(p.bet + sz) };
  }
  if(winrate > 0.45){
    if(need === 0){
      if(Math.random() < 0.4){
        const sz = game.pot * (0.4 + Math.random() * 0.4);
        return { type: 'raise', amount: Math.floor(p.bet + sz) };
      }
      return { type: 'check' };
    }
    if(potOdds < winrate) return { type: 'call' };
    return { type: 'fold' };
  }
  if(bluff && need === 0){
    const sz = game.pot * 0.5;
    return { type: 'raise', amount: Math.floor(p.bet + sz) };
  }
  if(need === 0) return { type: 'check' };
  if(potOdds < winrate * 0.8) return { type: 'call' };
  return { type: 'fold' };
}

module.exports = {
  Game,
  aiDecide,
  buildDeck,
  shuffle,
  evaluate7,
  bestFiveCardHand,
  cmpScore,
  HAND_TYPES,
  RANKS,
  RANK_VAL,
  SUITS,
};
