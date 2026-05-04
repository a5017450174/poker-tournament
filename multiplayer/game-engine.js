/* =========================================================================
   德撲錦標賽 — 遊戲邏輯引擎（server 端使用）
   經典模式：52 張、標準牌型大小、6 人桌
   v2: 加上 12 個角色天賦
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
   角色天賦資料（12 個）
   ========================================================================= */
const CHARACTERS = [
  { id:'soft_target', name:'專挑軟柿子', icon:'🍅',
    desc:'比牌獲勝時，從全場籌碼最少的對手額外多收 1 個小盲。' },
  { id:'gold_kick',   name:'黃金右腳', icon:'🦵',
    desc:'比牌時若你輸在踢腳，所有對手付你 3 個小盲補償（保留 1 個小盲給對手）。' },
  { id:'rich_richer', name:'強者恆強', icon:'👑',
    desc:'若你是全場籌碼最多，比牌獲勝後向每位輸家額外索取本手投入底池的 5%。' },
  { id:'rising_tide', name:'水漲船高', icon:'🌊',
    desc:'你加注後，跟注的對手每人額外付 1 個小盲到底池。' },
  { id:'imposing',    name:'氣勢凌人', icon:'💢',
    desc:'你加注時可以少付 1 個小盲（從加注金額扣除）。' },
  { id:'bully',       name:'惡霸', icon:'👹',
    desc:'翻牌前你加注後，若所有對手都棄牌，每位對手再付你 0.5 個小盲。' },
  { id:'street_king', name:'街頭小霸王', icon:'🥊',
    desc:'比牌獲勝時，每位輸家額外付你 2 個大盲。' },
  { id:'precision',   name:'精準出擊', icon:'🎯',
    desc:'小盲位或大盲位棄牌可拿回 1 個小盲。' },
  { id:'big_blind',   name:'大盲', icon:'🙈',
    desc:'你看不到自己底牌（全黑）。比牌獲勝時，每位輸家額外付他們本手投入底池的 100%。' },
  { id:'small_blind', name:'小盲', icon:'🙉',
    desc:'你只看得到一張底牌。比牌獲勝時，每位輸家額外付他們本手投入底池的 50%。' },
  { id:'advance',     name:'預支人生', icon:'💳',
    desc:'All-in 輸掉後，可向籌碼最多的對手借 1 個大盲繼續。下一局開始前要還，沒還就出局。' },
  { id:'east_money',  name:'東家錢', icon:'💰',
    desc:'每局開始時 50% 機率向上一局的贏家抽走 1 個小盲。' },
];

function hasTalent(p, id){ return p && p.talent === id; }

/* =========================================================================
   增幅能力資料（17 個）
   ========================================================================= */
const POWER_UPS = [
  { id:'arrogant',    name:'不可一世', icon:'🌟', desc:'用「高牌」贏下比牌時，每位輸家額外付你 1 個大盲。' },
  { id:'p_rule27',    name:'27 法則', icon:'✌️', desc:'底牌剛好 2&7 並贏下牌局時，全場每位對手付你 2 個大盲。' },
  { id:'three_kind',  name:'三條', icon:'3️⃣', desc:'用「三條」贏下比牌時，每位比牌的輸家額外付你 4 個大盲。' },
  { id:'pair_back',   name:'天生一對', icon:'👯', desc:'比牌輸了，但手牌是對子的話，可以拿回 2 個大盲。' },
  { id:'two_pair',    name:'兩對！', icon:'✨', desc:'用「兩對」贏下比牌時，每位輸家額外付你 3 個大盲。' },
  { id:'one_pair',    name:'對子', icon:'👫', desc:'用「一對」贏下比牌時，每位輸家額外付你 2 個大盲。' },
  { id:'magnet',      name:'吸金術', icon:'🧲', desc:'若贏牌當下你的籌碼少於底池總額的一半，額外獲得 1 個大盲。' },
  { id:'side_pot',    name:'邊池小偷', icon:'🦝', desc:'若有邊池且你贏下，可從邊池額外偷走 20% 籌碼。' },
  { id:'streak',      name:'連勝加成', icon:'🔥', desc:'連續贏 3 場比牌後，之後每次比牌獲勝可從每位對手額外拿 1 個小盲。' },
  { id:'second_rule', name:'老二法則', icon:'🥈', desc:'剩下一個對手且你的籌碼少於對手時，立刻隨機獲得一個額外能力。' },
  { id:'adventurer',  name:'冒險者', icon:'🎲', desc:'隨機選擇一個能力，發動的時候才會知道是甚麼。' },
  { id:'whetstone',   name:'磨刀石', icon:'⚒️', desc:'淘汰對手的回合可以額外拿到一個能力（一手最多拿一個）。' },
  { id:'comeback',    name:'逆轉王者', icon:'↩️', desc:'All-in 後河牌公開時，若你從劣勢反超對手，每位參與的對手付你 2 個大盲。' },
  { id:'biteback',    name:'反咬一口', icon:'🦈', desc:'All-in 戰勝比你籌碼多的對手時，額外獲得對手剩餘籌碼 10% 當獎勵。' },
  { id:'grit',        name:'忍痛割愛', icon:'💔', desc:'棄牌時若已投入超過總籌碼 30%，下一局可免費跟注大盲一次。' },
  { id:'second_life', name:'第二條命', icon:'🩹', desc:'All-in 輸後莊家借你 1 個當下大盲，本輪結束前要還，還不出來就出局。' },
  { id:'last_straw',  name:'救命稻草', icon:'🌾', desc:'每局結算後若你籌碼是全場最少，下一局的第一個大盲免費。' },
];

const POWER_BY_ID = Object.fromEntries(POWER_UPS.map(p=>[p.id,p]));

function hasPower(p, id){ return p && (p.powerUps||[]).includes(id); }

/* =========================================================================
   8 種變體玩法
   ========================================================================= */
const MODES = [
  { id:'classic',   name:'經典傳奇',  tagline:'最純粹、最標準的德州撲克。' },
  { id:'less',      name:'以少為多',  tagline:'從牌庫拿掉小數字，順子變稀有、同花更難中。' },
  { id:'joker',     name:'抽鬼牌',    tagline:'開場隨機抽掉幾個數字，整場都不會出現。' },
  { id:'bb_adv',    name:'大盲優勢',  tagline:'整副牌變加權，某個數字會超常出現。' },
  { id:'sunk',      name:'沉沒成本',  tagline:'翻牌前棄牌也要付逃跑費。' },
  { id:'fast_think',name:'快思快想',  tagline:'每回合決策時間縮短。' },
  { id:'fast_blind',name:'快速晉升',  tagline:'盲注上升速度更快。' },
  { id:'rule27',    name:'27 規則',    tagline:'拿到 2 跟 7 還能贏，全桌付你獎金。' },
];
function modeDetail(id, l){
  switch(id){
    case 'classic': return '52 張完整牌庫，標準牌型大小排序。';
    case 'less': return `本場拿掉 ${l===1?'2、3':l===2?'2、3、4':'2、3、4、5'}，牌庫剩 ${l===1?44:l===2?40:36} 張。順子變稀有，同花變得更強。`;
    case 'joker': return `本場開局隨機拿掉 ${l===1?'1 個數字':l===2?'2 個數字':'2 個數字 + 1 個花色'}（整場固定）。`;
    case 'bb_adv': return `本場主角數字出現機率為 ${l===1?25:l===2?35:50}%。0~4 分鐘以「2」為主角，4~8 分鐘以「8」，8 分鐘後以「A」。`;
    case 'sunk': return `翻牌前棄牌（非大小盲位）要付小盲的 ${l===1?20:l===2?50:80}%。`;
    case 'fast_think': return `決策時間縮減為基礎時間的 ${l===1?80:l===2?60:40}%。`;
    case 'fast_blind': return `盲注上升間隔：${l===1?'1 分 30 秒':l===2?'1 分 15 秒':'1 分鐘'}（原本 2 分鐘）。`;
    case 'rule27': return `底牌是 2 跟 7（任意花色）並贏下這手時，全桌每位對手付你 ${l===1?0.75:l===2?1:1.5} 倍大盲注。`;
  }
  return '';
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
    this.baseTurnTimeoutMs = 20000;  // 基礎，fast_think 模式會縮短
    this.started = false;
    this.ended = false;
    this.lastWinnerId = null;
    this.log = [];
    // 變體玩法
    this.mode = 'classic';
    this.level = 1;
    this.removedRanks = [];   // joker / less 拿掉的 rank
    this.removedSuit = null;  // joker level 3 拿掉的花色
    this.weightTable = null;  // bb_adv 的加權表
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
      talent: p.talent || null,        // 角色天賦 id
      powerUps: p.powerUps || [],      // 增幅能力 id 陣列
      flags: {},                       // freeBBNextHand / freeCallNextHand 等
      winStreak: 0,
      showdownWins: 0,
      _wasAllIn: false,
      _empty: false,
    });
  }

  addLog(msg){
    this.log.push({ t: Date.now(), msg });
    if(this.log.length > 200) this.log.shift();
  }

  // 把 chip transfer 推到 trigger 佇列，server 會 broadcast 給 client 顯示 toast / 動畫
  _transferChips(from, to, amount, label){
    if(!from || !to) return 0;
    const pay = Math.min(from.chips, Math.floor(amount));
    if(pay <= 0) return 0;
    from.chips -= pay;
    to.chips += pay;
    this._triggers.push({
      label,
      fromId: from.id,
      toId: to.id,
      amount: pay,
      icon: (CHARACTERS.find(c=> c.name===label) || {}).icon || '✦',
    });
    this.addLog(`✦ ${label}：${from.name} → ${to.name} ${pay}`);
    return pay;
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
    // 套用變體玩法
    this._applyMode();
  }

  // 把 mode/level 套用到 deck/timing 等
  _applyMode(){
    this.removedRanks = [];
    this.removedSuit = null;
    this.weightTable = null;
    const l = this.level || 1;
    const m = this.mode || 'classic';
    if(m === 'less'){
      this.removedRanks = l===1 ? ['2','3'] : l===2 ? ['2','3','4'] : ['2','3','4','5'];
    } else if(m === 'joker'){
      // 隨機拿掉
      const pool = RANKS.slice();
      for(let i=pool.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        [pool[i],pool[j]] = [pool[j],pool[i]];
      }
      const cnt = l===1?1 : l===2?2 : 2;
      this.removedRanks = pool.slice(0, cnt);
      if(l===3){
        this.removedSuit = SUITS[Math.floor(Math.random()*SUITS.length)];
      }
    } else if(m === 'bb_adv'){
      // 主角 rank 機率 25/35/50%
      this.weightTable = { pct: l===1?25 : l===2?35:50 };
    } else if(m === 'fast_think'){
      const factor = l===1?0.8 : l===2?0.6 : 0.4;
      this.turnTimeoutMs = Math.floor(this.baseTurnTimeoutMs * factor);
    } else if(m === 'fast_blind'){
      const ms = l===1?90000 : l===2?75000 : 60000;
      this.blindMs = ms;
    }
  }

  // 主角 rank（依時間決定）
  _heroRank(){
    if(this.mode !== 'bb_adv') return null;
    const elapsedMin = (Date.now() - (this.startTs||Date.now())) / 60000;
    if(elapsedMin < 4) return '2';
    if(elapsedMin < 8) return '8';
    return 'A';
  }

  buildModeDeck(){
    const valid = RANKS.filter(r=> !this.removedRanks.includes(r));
    const validSuits = this.removedSuit ? SUITS.filter(s=> s !== this.removedSuit) : SUITS;
    const d = [];
    for(const r of valid){
      for(const s of validSuits){
        d.push({ rank:r, suit:s, key:r+s });
      }
    }
    // bb_adv 加權：把主角 rank 的牌加倍出現
    if(this.weightTable){
      const hero = this._heroRank();
      if(hero){
        const heroCards = d.filter(c=> c.rank === hero);
        const pct = this.weightTable.pct;
        // 把主角從 d 移除，重新插入足夠多份讓佔比達到 pct
        const others = d.filter(c=> c.rank !== hero);
        const heroSetCount = Math.max(1, Math.round((others.length * pct / 100) / Math.max(1, (100-pct)/100) / heroCards.length));
        const newHero = [];
        for(let i=0;i<heroSetCount;i++) newHero.push(...heroCards.map(c=>({...c})));
        d.length = 0;
        d.push(...others, ...newHero);
      }
    }
    return d;
  }

  // 給予玩家一個能力
  awardPower(playerId, powerId){
    const p = this.players.find(x=> x.id === playerId);
    if(!p) return false;
    p.powerUps = p.powerUps || [];
    if(p.powerUps.includes(powerId)) return false;
    p.powerUps.push(powerId);
    this.addLog(`★ ${p.name} 獲得能力：${(POWER_BY_ID[powerId]||{}).name||powerId}`);
    return true;
  }

  // 給玩家挑 n 個未擁有的能力（隨機）
  rollPowerChoices(playerId, n=3){
    const p = this.players.find(x=> x.id === playerId);
    if(!p) return [];
    const owned = new Set(p.powerUps || []);
    const pool = POWER_UPS.filter(x=> !owned.has(x.id));
    const picks = [];
    for(let i=pool.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [pool[i],pool[j]] = [pool[j],pool[i]];
    }
    return pool.slice(0, n);
  }

  // 升盲檢查（外部 server tick 呼叫）
  // 不立即升盲：時間到只設 pendingBlindUp 旗標，等下一手開始時才真的升盲 + 跳提醒
  tickBlind(){
    if(!this.started || this.ended) return null;
    const elapsed = Date.now() - this.blindStartTs;
    if(elapsed >= this.blindMs && !this.pendingBlindUp){
      this.pendingBlindUp = true;
    }
    return null;
  }

  // 真正套用升盲（server 在 _nextHand 開新一手前呼叫）
  applyPendingBlindUp(){
    if(!this.pendingBlindUp) return null;
    this.pendingBlindUp = false;
    this.blindLevel++;
    this.sb *= 2;
    this.bb *= 2;
    this.blindStartTs = Date.now();
    this.addLog(`▲ 升盲：${this.sb}/${this.bb}`);
    return { level: this.blindLevel, sb: this.sb, bb: this.bb };
  }

  blindMsLeft(){
    if(!this.started || this.ended) return this.blindMs;
    if(this.pendingBlindUp) return 0;
    return Math.max(0, this.blindMs - (Date.now() - this.blindStartTs));
  }

  startHand(){
    // 預支人生事件先收集，等下面 _triggers 被重設後再 push
    const advanceEvents = [];
    // 移除已輸光的人
    this.players.forEach(p=>{
      if(!p.alive) return;
      if(p.chips > 0) return;
      // === 角色：預支人生 ===
      // All-in 輸掉、籌碼歸零的瞬間（在新一手開始前），向籌碼最多的對手借 1 個大盲撐一手
      // 一場錦標賽只能用一次（_advanceUsed flag）
      if(hasTalent(p, 'advance') && !p._advanceUsed){
        const lender = this.players
          .filter(x=> x.alive && x.id !== p.id && x.chips > this.bb)
          .sort((a,b)=> b.chips - a.chips)[0];
        if(lender){
          const loan = this.bb;
          lender.chips -= loan;
          p.chips += loan;
          p._advanceUsed = true;
          advanceEvents.push({
            label:'預支人生', icon:'💳',
            fromId: lender.id, toId: p.id, amount: loan,
            note:`${p.name} 向 ${lender.name} 借 ${loan} 大盲續命`,
          });
          this.addLog(`💳 預支人生：${p.name} 向 ${lender.name} 借 ${loan} 撐一手`);
          return; // 不淘汰
        }
      }
      // 真的出局
      p.alive = false;
      p.eliminatedAtHand = this.handNum;
      this.addLog(`✘ ${p.name} 出局`);
    });
    const aliveCount = this.players.filter(p=>p.alive).length;
    if(aliveCount <= 1){
      this.ended = true;
      return false;
    }
    this.handNum++;
    this._triggers = [];
    // 把上面收集的預支人生事件 push 進來（這樣不會被上一行清掉）
    if(advanceEvents.length){
      this._triggers.push(...advanceEvents);
    }
    this.players.forEach(p=>{
      p.hole = [];
      p.folded = false;
      p.allIn = false;
      p.bet = 0;
      p.totalBet = 0;
      p._wasAllIn = false;
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

    // 重建並洗牌（依模式）
    this.deck = (this.mode && this.mode !== 'classic') ? this.buildModeDeck() : buildDeck();
    shuffle(this.deck);
    this.validRanks = new Set(RANKS.filter(r=> !this.removedRanks.includes(r)));

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
    // 救命稻草：BB 免費
    const bbPlayer = this.players[bbPos];
    if(bbPlayer.flags && bbPlayer.flags.freeBBNextHand){
      bbPlayer.bet = this.bb; bbPlayer.totalBet = this.bb; this.pot += this.bb;
      this._triggers.push({
        label:'救命稻草', icon:'🌾',
        fromId:null, toId:bbPlayer.id, amount:this.bb,
        note:`${bbPlayer.name} 大盲免費`,
      });
      this.addLog(`✦ 救命稻草：${bbPlayer.name} 大盲免費（省 ${this.bb}）`);
      bbPlayer.flags.freeBBNextHand = false;
    } else {
      this._postBlind(bbPlayer, this.bb, 'BB');
    }
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
    this._lastRaiserId = null;
    this._streetWhenRaised = null;

    // ====== 角色：每手開局觸發（east_money）======
    this._runHandStartTriggers();

    return true;
  }

  _runHandStartTriggers(){
    this.players.forEach(p=>{
      if(!p.alive || p._empty) return;
      if(hasTalent(p, 'east_money') && this.lastWinnerId !== null && this.lastWinnerId !== p.id){
        if(Math.random() < 0.5){
          const target = this.players.find(x=> x.id === this.lastWinnerId);
          if(target && target.alive) this._transferChips(target, p, this.sb, '東家錢');
        }
      }
    });
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
      // 角色：精準出擊（小盲/大盲位棄牌退回 1 SB）
      if(hasTalent(p, 'precision')){
        const playerIdx = this.players.indexOf(p);
        if(playerIdx === this.sbPos || playerIdx === this.bbPos){
          const refund = Math.min(this.pot, this.sb);
          if(refund > 0){
            this.pot -= refund;
            p.chips += refund;
            this._triggers.push({
              label:'精準出擊', icon:'🎯',
              fromId:null, toId:p.id, amount:refund,
            });
            this.addLog(`✦ 精準出擊：${p.name} 退回 ${refund}`);
          }
        }
      }
      // 變體：沉沒成本（preflop 棄牌罰 SB%，非小大盲位）
      if(this.mode === 'sunk' && this.street === 'preflop'){
        const playerIdx = this.players.indexOf(p);
        if(playerIdx !== this.sbPos && playerIdx !== this.bbPos){
          const factor = this.level===1?0.2 : this.level===2?0.5 : 0.8;
          const penalty = Math.min(p.chips, Math.floor(this.sb * factor));
          if(penalty > 0){
            p.chips -= penalty;
            this.pot += penalty;
            this._triggers.push({
              label:'沉沒成本', icon:'💸',
              fromId:p.id, toId:null, amount:penalty,
              note:`${p.name} 逃跑費`,
            });
            this.addLog(`✦ 沉沒成本：${p.name} 逃跑費 ${penalty}`);
          }
        }
      }
      // 能力：忍痛割愛（投入超過 30% 籌碼 → 下一手免費跟大盲）
      if(hasPower(p, 'grit')){
        const totalChips = p.chips + (p.totalBet||0);
        if(totalChips > 0 && (p.totalBet||0)/totalChips > 0.3){
          p.flags = p.flags || {};
          p.flags.freeCallNextHand = true;
          this._triggers.push({
            label:'忍痛割愛', icon:'💔',
            fromId:null, toId:p.id, amount:0,
            note:`${p.name} 下一局免費跟大盲`,
          });
          this.addLog(`✦ 忍痛割愛：${p.name} 下一局可免費跟大盲一次`);
        }
      }
    } else if(action.type === 'check'){
      if(need !== 0) return { ok:false, error:'cannot check, must call or fold' };
      this.addLog(`${p.name} 過牌`);
    } else if(action.type === 'call'){
      let pay = Math.min(need, p.chips);
      // 能力：忍痛割愛（preflop 免費跟大盲）—— bb 那部分免費，超過 bb 的部分照付
      if(p.flags && p.flags.freeCallNextHand && this.street === 'preflop' && pay > 0){
        const refund = Math.min(pay, this.bb);
        const realPay = pay - refund;
        p.chips -= realPay;
        this.pot += realPay;
        p.bet += pay;          // 視為已對齊 highestBet
        p.totalBet += pay;
        this._triggers.push({
          label:'忍痛割愛', icon:'💔',
          fromId:null, toId:p.id, amount:refund,
          note:`${p.name} 免費跟大盲（省）`,
        });
        this.addLog(`✦ 忍痛割愛：${p.name} 免費跟大盲（省 ${refund}）`);
        p.flags.freeCallNextHand = false;
        if(p.chips === 0) p.allIn = true;
        this.hasActedThisRound.add(p.id);
        return { ok:true };
      }
      p.chips -= pay;
      p.bet += pay;
      p.totalBet += pay;
      this.pot += pay;
      if(p.chips === 0) p.allIn = true;
      this.addLog(`${p.name} 跟注 ${pay}`);
      // 角色：水漲船高（跟注的對手多付 1 SB）
      if(this._lastRaiserId !== null && this._lastRaiserId !== p.id){
        const raiser = this.players.find(x=> x.id === this._lastRaiserId);
        if(raiser && hasTalent(raiser, 'rising_tide')){
          const extra = Math.min(p.chips, this.sb);
          if(extra > 0){
            p.chips -= extra;
            this.pot += extra;
            this._triggers.push({
              label:'水漲船高', icon:'🌊',
              fromId:p.id, toId:raiser.id, amount:extra,
              note:`${p.name} 多付進底池`,
            });
            this.addLog(`✦ 水漲船高：${p.name} 多付 ${extra} 進底池`);
          }
        }
      }
    } else if(action.type === 'raise' || action.type === 'allin'){
      let target;
      if(action.type === 'allin'){
        target = p.bet + p.chips;
      } else {
        target = action.amount || (this.highestBet + this.minRaise);
      }
      target = Math.max(target, this.highestBet + this.minRaise);
      // 角色：氣勢凌人（加注 target 少 1 SB；不適用 all-in）
      if(action.type === 'raise' && hasTalent(p, 'imposing')){
        const reduced = Math.max(this.bb, target - this.sb);
        if(reduced < target){
          this._triggers.push({
            label:'氣勢凌人', icon:'💢',
            fromId:null, toId:p.id, amount:this.sb,
            note:`${p.name} 加注少付`,
          });
          target = reduced;
        }
      }
      target = Math.min(target, p.bet + p.chips);
      const pay = target - p.bet;
      if(pay <= 0) return { ok:false, error:'invalid raise' };
      p.chips -= pay;
      p.bet = target;
      p.totalBet += pay;
      this.pot += pay;
      if(p.chips === 0){ p.allIn = true; p._wasAllIn = true; }
      if(action.type === 'allin') p._wasAllIn = true;
      if(target > this.highestBet){
        this.lastRaiseAmt = target - this.highestBet;
        this.minRaise = this.lastRaiseAmt;
        this.highestBet = target;
        this._lastRaiserId = p.id;
        this._streetWhenRaised = this.street;
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

  // 推進回合：回傳 { phase: 'next-action'|'next-street'|'showdown'|'auto-runout', currentId? }
  advance(){
    const remaining = this.players.filter(p=> p.alive && !p.folded);
    if(remaining.length <= 1){
      return { phase: 'showdown' };
    }
    if(this._roundComplete()){
      // 修正重大 bug：若這條街完成後，能繼續下注的人 ≤ 1（其他人都 all-in），
      // 不該再進新街給單獨那位玩家亂加注 → 直接把剩下街發完、進 showdown
      const canStillBet = remaining.filter(p => !p.allIn);
      if(canStillBet.length <= 1){
        return this._autoRunout();
      }
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

  // ===== 自動發完剩下的公牌（適用於：能下注的人 ≤ 1 的場面） =====
  // 注意：這裡「不發牌」，只回傳還沒發的街序列。
  // 之所以不立刻發完，是因為 server 接著會 _broadcastState，
  // 若這時 community 已是 5 張，client 會先閃一下完整公牌再被 street event 覆蓋。
  // 改由 server 在 setTimeout 序列裡一張一張 deal + broadcast。
  _autoRunout(){
    this.players.forEach(p => { p.bet = 0; });
    // 沒人輪到行動了 → 清掉 currentPos 避免 client 仍 highlight 誰
    this.currentPos = -1;
    this.toAct = new Set();
    this.hasActedThisRound = new Set();
    this.highestBet = 0;
    const pending = [];
    if(this.street === 'preflop') pending.push('flop','turn','river');
    else if(this.street === 'flop') pending.push('turn','river');
    else if(this.street === 'turn') pending.push('river');
    // 'river' 已在最後一張 → pending 空陣列，server 會直接進 showdown
    return { phase: 'auto-runout', pendingStreets: pending };
  }

  // ===== 計算 side pots =====
  // 根據每個玩家的 totalBet 累積，把底池切成「主池 + 邊池們」
  // 每個 pot 有 amount 跟 eligibleIds（沒棄牌、且至少投到該層的玩家）
  _computeSidePots(){
    const all = this.players.filter(p => (p.totalBet || 0) > 0);
    if(!all.length) return [];
    const sorted = [...all].sort((a,b) => (a.totalBet||0) - (b.totalBet||0));
    const pots = [];
    let prev = 0;
    for(const p of sorted){
      const cap = p.totalBet || 0;
      if(cap > prev){
        const layerSize = cap - prev;
        const contribs = sorted.filter(x => (x.totalBet||0) > prev);
        const potAmt = layerSize * contribs.length;
        const eligible = contribs.filter(x => !x.folded && x.alive).map(x => x.id);
        if(potAmt > 0){
          if(eligible.length){
            pots.push({ amount: potAmt, eligibleIds: eligible });
          } else if(pots.length){
            // 此層沒人有資格贏（理論上不會發生，因為只有棄牌才會 not-eligible）→ 併到上一個
            pots[pots.length-1].amount += potAmt;
          } else {
            pots.push({ amount: potAmt, eligibleIds: [] });
          }
        }
        prev = cap;
      }
    }
    return pots;
  }

  // 比牌結算 → 回傳 { winners, losers, handType, handName, matchedKeys, triggers, foldOut }
  showdown(){
    const remaining = this.players.filter(p=> p.alive && !p.folded);
    const potSnapshot = this.pot;
    if(remaining.length === 1){
      const w = remaining[0];
      w.chips += potSnapshot;
      this.pot = 0;
      this.lastWinnerId = w.id;
      this.addLog(`${w.name} 贏下底池 ${potSnapshot}（其他人都棄牌）`);
      // 角色：惡霸（翻牌前棄牌出局）
      if(hasTalent(w, 'bully') && this._lastRaiserId === w.id && this._streetWhenRaised === 'preflop'){
        this.players.filter(p=> p!==w && p.alive && !p._empty).forEach(o=>{
          this._transferChips(o, w, this.sb*0.5, '惡霸');
        });
      }
      return {
        winners: [w.id],
        losers: [],
        potWon: potSnapshot,
        foldOut: true,
        triggers: this._triggers.slice(),
      };
    }
    const evals = remaining.map(p=>{
      const ev = evaluate7(p.hole.concat(this.community), this.validRanks);
      return { p, ev };
    });
    const evalById = new Map(evals.map(e => [e.p.id, e]));
    // 整體最佳手牌（用於 talent / hand-name 顯示）
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

    // === Side pot 結算 ===
    // 每個 pot 各自找 eligible 中最好的牌 → 拿那個 pot
    // 修正重大 bug：all-in 玩家最多只能拿走自己有蓋到的層級，多餘的歸還給有壓更多的玩家
    const pots = this._computeSidePots();
    const potBreakdown = [];
    const wonChipsById = new Map();   // 玩家 id → 實際贏到的 chips 累積
    pots.forEach((pot, potIdx) => {
      const eligibleEvals = pot.eligibleIds
        .map(id => evalById.get(id))
        .filter(Boolean);
      if(!eligibleEvals.length) return;
      let bestE = eligibleEvals[0].ev.score;
      for(const e of eligibleEvals) if(cmpScore(e.ev.score, bestE) > 0) bestE = e.ev.score;
      const potWinners = eligibleEvals.filter(e => cmpScore(e.ev.score, bestE) === 0);
      const share = Math.floor(pot.amount / potWinners.length);
      const remainShare = pot.amount - share * potWinners.length;
      potWinners.forEach(w => {
        w.p.chips += share;
        wonChipsById.set(w.p.id, (wonChipsById.get(w.p.id) || 0) + share);
      });
      if(remainShare > 0 && potWinners.length){
        potWinners[0].p.chips += remainShare;
        wonChipsById.set(potWinners[0].p.id, (wonChipsById.get(potWinners[0].p.id) || 0) + remainShare);
      }
      const label = potIdx === 0 ? '主池' : `邊池 ${potIdx}`;
      this.addLog(`★ ${potWinners.map(w=>w.p.name).join('、')} 贏下${label} ${pot.amount}`);
      potBreakdown.push({
        label,
        amount: pot.amount,
        winnerIds: potWinners.map(w => w.p.id),
      });
    });
    this.pot = 0;
    // 真正贏到 chip 的人聯集 → 給 UI 顯示用（含 side pot 贏家）
    const allWinnerIds = new Set([...wonChipsById.keys()]);
    if(allWinnerIds.size){
      const realWinners = remaining.filter(p => allWinnerIds.has(p.id));
      // 重組 winners / losers：贏到任何 pot 的算 winner，其餘算 loser
      winners.length = 0;
      winners.push(...realWinners);
      losers.length = 0;
      losers.push(...remaining.filter(p => !allWinnerIds.has(p.id)));
    }
    this.lastWinnerId = winners[0]?.id ?? null;

    // ====== 角色 + 能力：showdown 觸發 ======
    const sb = this.sb, bb = this.bb, handType = best[0];
    const potSnap = potSnapshot;
    winners.forEach(w=>{
      // ----- 角色 -----
      if(hasTalent(w, 'street_king')){
        losers.forEach(l=> this._transferChips(l, w, bb*2, '街頭小霸王'));
      }
      if(hasTalent(w, 'rich_richer')){
        const maxChips = Math.max(...this.players.filter(p=>p.alive).map(p=>p.chips));
        if(w.chips >= maxChips){
          losers.forEach(l=> this._transferChips(l, w, (l.totalBet||0)*0.05, '強者恆強'));
        }
      }
      if(hasTalent(w, 'soft_target')){
        const opps = this.players.filter(p=> p!==w && p.alive && !p._empty);
        if(opps.length){
          const poorest = opps.reduce((a,b)=> a.chips<=b.chips?a:b);
          this._transferChips(poorest, w, sb, '專挑軟柿子');
        }
      }
      if(hasTalent(w, 'big_blind')){
        losers.forEach(l=> this._transferChips(l, w, l.totalBet||0, '大盲'));
      }
      if(hasTalent(w, 'small_blind')){
        losers.forEach(l=> this._transferChips(l, w, (l.totalBet||0)*0.5, '小盲'));
      }
      // ----- 能力 -----
      if(hasPower(w, 'arrogant') && handType === 0){
        losers.forEach(l=> this._transferChips(l, w, bb, '不可一世'));
      }
      if(hasPower(w, 'one_pair') && handType === 1){
        losers.forEach(l=> this._transferChips(l, w, bb*2, '對子'));
      }
      if(hasPower(w, 'two_pair') && handType === 2){
        losers.forEach(l=> this._transferChips(l, w, bb*3, '兩對！'));
      }
      if(hasPower(w, 'three_kind') && handType === 3){
        losers.forEach(l=> this._transferChips(l, w, bb*4, '三條'));
      }
      if(hasPower(w, 'streak') && (w.winStreak||0) >= 3){
        losers.forEach(l=> this._transferChips(l, w, sb, '連勝加成'));
      }
      if(hasPower(w, 'p_rule27')){
        const ranks = (w.hole||[]).map(c=>c.rank).sort();
        if(ranks.length===2 && ranks.includes('2') && ranks.includes('7')){
          this.players.filter(p=> p!==w && p.alive && !p._empty).forEach(o=>{
            this._transferChips(o, w, bb*2, '27 法則');
          });
        }
      }
      if(hasPower(w, 'magnet')){
        if(w.chips < potSnap/2){
          const richestLoser = losers.length ? losers.reduce((a,b)=> a.chips>=b.chips?a:b) : null;
          if(richestLoser) this._transferChips(richestLoser, w, bb, '吸金術');
        }
      }
      if(hasPower(w, 'biteback') && w._wasAllIn){
        losers.forEach(l=>{
          if((l.chips + (l.totalBet||0)) > (w.chips + (w.totalBet||0))){
            this._transferChips(l, w, l.chips * 0.1, '反咬一口');
          }
        });
      }
      // ----- 變體：rule27 mode -----
      if(this.mode === 'rule27'){
        const ranks = (w.hole||[]).map(c=>c.rank).sort();
        if(ranks.length===2 && ranks.includes('2') && ranks.includes('7')){
          const factor = this.level===1?0.75 : this.level===2?1 : 1.5;
          this.players.filter(p=> p!==w && p.alive && !p._empty).forEach(o=>{
            this._transferChips(o, w, Math.floor(bb*factor), '27 規則');
          });
        }
      }
      w.winStreak = (w.winStreak||0) + 1;
      w.showdownWins = (w.showdownWins||0) + 1;
    });
    losers.forEach(l=>{
      if(hasTalent(l, 'gold_kick')){
        const myEv = evals.find(e=> e.p===l);
        const winEv = evals.find(e=> winners.includes(e.p));
        if(myEv && winEv && myEv.ev.score[0] === winEv.ev.score[0]){
          let lostByKicker = false;
          for(let i=1; i<Math.max(myEv.ev.score.length, winEv.ev.score.length); i++){
            const a = myEv.ev.score[i]||0, b = winEv.ev.score[i]||0;
            if(a !== b){ lostByKicker = (a < b); break; }
          }
          if(lostByKicker){
            this.players.filter(p=> p!==l && p.alive && !p._empty).forEach(o=>{
              const owe = sb*3, reserve = sb;
              const cap = Math.max(0, o.chips - reserve);
              const pay = Math.min(cap, owe);
              if(pay > 0) this._transferChips(o, l, pay, '黃金右腳');
            });
          }
        }
      }
      // 能力：天生一對（手牌是對子，輸了拿回 2 BB）
      if(hasPower(l, 'pair_back')){
        const ranks = (l.hole||[]).map(c=>c.rank);
        if(ranks.length===2 && ranks[0]===ranks[1]){
          winners.forEach(w=> this._transferChips(w, l, bb*2, '天生一對'));
        }
      }
      l.winStreak = 0;
    });

    // 結算後：last_straw 旗標（最少籌碼者下局 BB 免費）
    const aliveAfter = this.players.filter(p=> p.alive && !p._empty);
    if(aliveAfter.length){
      const minChips = Math.min(...aliveAfter.map(p=>p.chips));
      aliveAfter.forEach(p=>{
        if(p.chips === minChips && hasPower(p, 'last_straw')){
          p.flags = p.flags || {};
          p.flags.freeBBNextHand = true;
        }
      });
    }

    // 偵測本手淘汰的人 + 找 killer（給能力選擇用）
    const eliminated = losers.filter(l=> l.chips <= 0).map(l=> l.id);
    let killer = null;
    if(eliminated.length){
      const winnerByChips = winners.slice().sort((a,b)=> b.chips - a.chips)[0];
      killer = winnerByChips ? winnerByChips.id : null;
    }

    return {
      winners: winners.map(w=>w.id),
      losers: losers.map(l=>l.id),
      handType: best[0],
      handName,
      matchedKeys: sdKeys,
      reveals: remaining.reduce((acc,p)=>{ acc[p.id] = p.hole; return acc; }, {}),
      potWon: potSnapshot,
      potBreakdown,
      foldOut: false,
      triggers: this._triggers.slice(),
      eliminated,
      killer,
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
      players: this.players.map(p=>{
        // 角色：大盲全黑 / 小盲只看一張
        let visibleHole = null;
        if(forPlayerId !== null && p.id === forPlayerId){
          if(p.talent === 'big_blind'){
            visibleHole = null;     // client 會 render 兩張背面
          } else if(p.talent === 'small_blind' && p.hole.length >= 2){
            visibleHole = [p.hole[0]];   // 只送第一張，第二張 client render 背面
          } else {
            visibleHole = p.hole;
          }
        }
        return {
          id: p.id,
          name: p.name,
          isAI: p.isAI,
          chips: p.chips,
          bet: p.bet,
          totalBet: p.totalBet,
          alive: p.alive,
          folded: p.folded,
          allIn: p.allIn,
          talent: p.talent || null,
          powerUps: (p.powerUps || []).slice(),
          hole: visibleHole,
          hasHole: p.hole.length > 0,
        };
      }),
      mode: this.mode,
      level: this.level,
      removedRanks: this.removedRanks.slice(),
      removedSuit: this.removedSuit,
      heroRank: this._heroRank(),
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
  CHARACTERS,
  POWER_UPS,
  MODES,
  modeDetail,
  hasTalent,
  hasPower,
};
