# 德撲錦標賽 — 多人連線版

從原本單檔 HTML 重構成 client + server 架構，可放上 Render 跟朋友連線一起玩。

## 架構

```
multiplayer/
├── server.js          ← Node.js + Express + ws WebSocket server
├── game-engine.js     ← 純遊戲邏輯（牌庫、評估、betting、AI）
├── package.json       ← 相依（express、ws）
├── render.yaml        ← Render 部署設定
└── public/
    └── index.html     ← Client（lobby + 牌桌）
```

## MVP 功能

- ✅ 房間建立 + 5 字邀請碼
- ✅ 朋友輸入碼加房
- ✅ 經典模式（標準德撲、52 張）
- ✅ 真人 1-6 + AI 補位
- ✅ 完整下注（fold / check / call / raise / all-in）
- ✅ 自動升盲
- ✅ Showdown 評估 + 牌型大字
- ✅ 觀戰模式（淘汰後可繼續看，遊戲中加入也是觀戰）
- ✅ 籌碼排行（FLIP 動畫）
- ✅ 思考時間倒數 + 逾時自動處理
- ✅ 房主斷線會把該玩家自動標棄牌
- ✅ 邀請連結可一鍵複製

## v2 已上：角色 + 視覺特效

- ✅ 12 個角色天賦（大廳可選；不選會隨機分）
  - 專挑軟柿子 / 黃金右腳 / 強者恆強 / 水漲船高 / 氣勢凌人 / 惡霸
  - 街頭小霸王 / 精準出擊 / 大盲 / 小盲 / 預支人生 / 東家錢
- ✅ 角色觸發 toast（飛字 + chip 移轉）
- ✅ 升盲大型階段彈窗
- ✅ 比牌大字牌型名（同花順 / 葫蘆等中文飛入）
- ✅ 比牌時 winner 的關鍵牌發光
- ✅ 加注 / 跟注 / All-in 座位上方文字 + 飛籌碼到底池
- ✅ 贏家 WIN 徽章 + 籌碼從底池飛回
- ✅ 玩家當前牌型即時顯示（側欄呼吸燈）+ 升級 toast

## v3 已上：增幅能力 + 8 種變體玩法

**C — 17 個增幅能力（淘汰對手後 3 選 1）**
- 不可一世 / 27 法則 / 三條 / 天生一對 / 兩對！/ 對子
- 吸金術 / 邊池小偷 / 連勝加成 / 老二法則 / 冒險者 / 磨刀石
- 逆轉王者 / 反咬一口 / 忍痛割愛 / 第二條命 / 救命稻草
- 淘汰對手後 30 秒選一個（沒選會隨機指派）
- 其他玩家會看到「X 淘汰對手，正在選能力…」橫幅
- 升盲計時器在選能力時暫停

**D — 8 種變體玩法（每種 3 個等級）**
- 經典傳奇 / 以少為多 / 抽鬼牌 / 大盲優勢
- 沉沒成本 / 快思快想 / 快速晉升 / 27 規則
- 房主大廳可選 mode + level，遊戲畫面頂部 banner 顯示

## 本地測試

```bash
cd multiplayer
npm install
npm start
```

打開兩個瀏覽器分頁 `http://localhost:3000`：
1. 第一個分頁：選「建立房間」、輸入名字、AI 數設 0、開始 → 拿到 5 字邀請碼
2. 第二個分頁：選「加入房間」、輸入剛剛的邀請碼、輸入名字
3. 回第一個分頁點「開始遊戲」

或開三個分頁一個房主開房 + 兩個朋友模擬 + 自帶 AI 補位。

## 部署到 Render（5 分鐘）

### 第 1 步：把整個 `德撲` 資料夾推到 GitHub

打開 Windows `cmd`：

```bash
cd D:\Claude\德撲
git init
git add .
git commit -m "first commit"
git branch -M main
```

去 GitHub 建一個 repo（例：`poker-tournament`），public，**不要**加 README。然後：

```bash
git remote add origin https://github.com/你的帳號/poker-tournament.git
git push -u origin main
```

第一次 push 會問帳密：用 GitHub 個人 access token（Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token，勾 `repo`）。

### 第 2 步：去 Render 部署

1. 去 https://render.com 註冊（用 GitHub 登入最快）
2. Dashboard → **New +** → **Web Service**
3. Connect 剛才的 repo
4. Render 會自動讀 `multiplayer/render.yaml` 設定，但你要確認：
   - **Name**: `poker-tournament`（隨便）
   - **Root Directory**: `multiplayer`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. **Create Web Service**
6. 等 2-3 分鐘 build → 拿到網址 `https://poker-tournament.onrender.com`

### 第 3 步：玩

把網址丟給朋友。每個人各自打開：
- 一個人選「建立房間」拿到邀請碼
- 把網址 `https://poker-tournament.onrender.com/?code=ABC123` 丟給朋友
- 朋友點開直接帶碼，輸入名字就能進
- 房主點「開始遊戲」

## Free Plan 注意事項

Render Free Plan 規則：
- 15 分鐘沒 traffic → 服務睡眠
- 朋友開連結 → **要等約 30 秒冷啟動**
- 玩家上線後就不會再睡
- 一個月 750 小時運行時間（夠用）

如果不想 30 秒等待：
- 升級 Starter $7/月 → 不會睡
- 或用 https://uptimerobot.com 每 5 分鐘 ping 你一次保持醒著（免費）

## Bug / 已知限制

- **重連會掉狀態**：玩家斷線重連後不會自動回到原本的座位（會被當新玩家），目前重連 = 從零開始
- **房間不會自動清理**：所有真人都離開後房間會被刪，但如果有殘留 AI 可能不會
- **沒有 reconnect token**：URL 帶 code 是進入觀戰，不是回到原座位
- **多人 all-in 不一樣籌碼時 side pot 沒實作**：贏家會拿到全部底池

之後可以加。

## 訊息協定

### Client → Server

```js
{ type:'create-room', name, settings:{ aiCount, baseTurnSec, blindMs } }
{ type:'join-room', name, code }
{ type:'start-game' }                                  // 房主開
{ type:'action', action:{ type:'fold'|'check'|'call'|'raise'|'allin', amount? } }
{ type:'leave-room' }
{ type:'ping' }
```

### Server → Client

```js
{ type:'room-created', code, playerId, lobby }         // 給建房者
{ type:'room-joined', code, playerId, lobby }          // 給加房者
{ type:'spectator-joined', code, lobby }               // 遊戲已開始時加入
{ type:'lobby-update', lobby }                         // lobby 變動廣播
{ type:'game-started' }
{ type:'game-state', state, yourId, currentPlayerId, turnDeadline, yourTurn? }
{ type:'action-result', playerId, action, pot, players }
{ type:'street', street, community }
{ type:'showdown', result:{ winners, losers, handType, handName, matchedKeys, reveals, potWon, foldOut }, players }
{ type:'blind-up', level, sb, bb }
{ type:'blind-tick', msLeft }
{ type:'tournament-end', rankings, handNum }
{ type:'error', msg }
```

## 進度文件

開新對話接手請參考根目錄的 `進度報告.md`（單機版的全部歷史）+ 這份 README。
