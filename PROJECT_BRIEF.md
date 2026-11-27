# Embervault 專案簡報

本文件供新 session 快速了解專案全貌；需要細節時按下方文件索引深入。**本檔是唯一「隨進度持續更新」的文件**（每個階段收尾更新一次）。

最後更新：2026-11-27

> **當前進度**：單人完整玩法（三職業、40 層四大區域、遺物與套裝、城鎮與倉庫、倒地與傳送門、多英雄引擎與本機 bot 隊友）以及 **Cloudflare 帳號存檔（P1）**、**倉庫（P2）**、**死亡與傳送門改版（P3）**、**多英雄與城鎮場景分離（P4-A／P4-B／P4-C）**、**多人房間基礎設施（P5-A）**、**多人地城即時同步（P5-B）**、**城鎮同步與多人進出流程（P5-C）** 皆已完成並合併至 `main`，Room Worker 也已部署更新至 P5-C 版本；**P6 城鎮交易與 P7 中途加入／重連＋打磨也已合併至 `main`（P7 merge `43c0e9d`，雙瀏覽器端到端驗收仍待進行）**。目前 1–4 人可完整開房協力打地城、在城鎮互看模型與名牌、全員回城後任一人先行解凍回地城、使用隊伍面板與遊戲內聊天；遊戲開始後可中途加入、斷線自動重連。路線圖外另新增第三職業**亞馬遜獵人**（`8520060`，弓箭普攻、隨機戰寵與多人戰寵同步）與戰士／法師祭壇升級平衡（`3ff73a3`、`cdb7369`）。

---

## 專案概述

**Embervault** 是一款 3D 等角視角（Isometric）程序化地城探索動作 RPG，支援 **1–4 人合作**，主打動態提燈陰影、自動探索／戰鬥 AI 與無縫手動操作切換、Web Audio 程序化音效與跨局雲端角色存檔。

- **前端技術棧**：TypeScript + Vite 8 + React 19 + Tailwind CSS 4 + Three.js + Web Audio（`src/`）
- **後端與資料層**：Cloudflare Pages Functions（`functions/`）+ Cloudflare D1 SQLite（`migrations/0001_init.sql`）+ Google Identity Services ID Token 登入（`jose` 驗證、HttpOnly cookie `ev_session`）
- **多人房間架構**：獨立私有 Worker `ember-vault-room`（`workers/room/`）內的 SQLite Durable Object `Room`（WebSocket Hibernation API），透過 Pages `ROOM` binding 代理；採**房主權威**模式（房主跑地城模擬、其他人送輸入收快照；城鎮各客戶端本機模擬；單人模式完全不開房、不連 DO）
- **核心玩法內容**：
  - **三職業**：燈守戰士（近戰三段連斬、劍柄重擊暈眩、衝刺、護甲）、冰雪法師（三發循環冰尖彈含緩速／爆炸、冰霜新星、閃現、自動回充護盾）與亞馬遜獵人（高射速單體弓箭、天生 20% 爆擊與 1.2 倍移速、疾步、右鍵召喚／強化隨機戰寵熊／陸行鳥／狼）；祭壇升級三職業皆為總計 60 次。
  - **40 層四大區域**：石造地城（1–10）、地下洞窟（11–20）、巨獸體內（21–30）、外星飛船（31–40），各具地形主題、敵人族群、菁英與 Boss。
  - **跨局進度**：每帳號最多 8 角色，雲端保留金幣、金幣升級、最高到達層數（`max_depth`）、藥水、裝備中遺物（4 格）、背包（30 格）與城鎮倉庫（200 格）。

## 目錄結構

```text
.
├── docs/
│   ├── multiplayer-spec.md       # 多人連線 × 帳號存檔規格書（P1～P7 單一來源）
│   ├── mage-spec.md              # 冰雪法師規格書
│   ├── hunter-spec.md            # 亞馬遜獵人規格書（弓箭、戰寵、升級、遺物特例）
│   ├── p1-setup.md               # P1 Google OAuth、D1 與本機開發設定指南
│   └── p5-setup.md               # P5-A Room Worker 部署、本機三開與流量預算指南
├── migrations/
│   └── 0001_init.sql             # D1 schema：accounts, sessions, characters, trades
├── shared/                       # 瀏覽器／Pages Functions／Room Worker 共用純 TS
│   ├── character.ts              # 角色存檔型別與數量上限（8 角色 / 4 裝 / 30 包 / 200 倉）
│   ├── trade.ts                  # P6 交易提供型別與純函式 `applyTrade`（驗證物品／金幣／空間並算出新存檔）
│   ├── room.ts                   # 房間 WebSocket 協定、close codes、分角色速率與大小上限
│   └── game.ts                   # P5-B 遊戲同步協定（快照、輸入、指令、城鎮交接）與流量常數
├── functions/                    # Cloudflare Pages Functions（API 與 WS 代理）
│   ├── _lib/                     # auth, characters, env, http, rooms, validate
│   └── api/
│       ├── _middleware.ts        # 同源檢查與通用中介層
│       ├── config.ts / me.ts     # 公開設定（GOOGLE_CLIENT_ID）與登入狀態
│       ├── auth/                 # google.ts, logout.ts, dev.ts（僅 DEV_AUTH=1）
│       ├── characters/           # 角色列表、建立、讀取、存檔（base_version）、刪除
│       └── rooms/                # POST /api/rooms 開房、GET /api/rooms/:code/ws 代理
├── workers/room/                 # 獨立私有 Worker `ember-vault-room`（無公開路由）
│   ├── wrangler.toml             # SQLite DO migration v1（new_sqlite_classes = ["Room"]）
│   └── src/                      # index.ts（Room Durable Object：Hibernation、聊天、relay、P6 交易仲裁）、trade.ts（D1 讀寫與 batch）
├── src/                          # 前端 React + Three.js 應用
│   ├── App.tsx / main.tsx / api.ts / saveManager.ts
│   ├── net/roomClient.ts         # 瀏覽器房間 WebSocket 客戶端
│   ├── components/               # AccountScreens, RoomScreens, StashModal, RelicModals, ClassEmblem
│   └── game/                     # engine.ts, hero.ts, classes.ts, dungeon.ts, relics.ts,
│                                 # models.ts, textures.ts, audio.ts, types.ts
├── wrangler.toml                 # Pages 設定（D1 binding DB、ROOM DO binding、GOOGLE_CLIENT_ID）
└── package.json                  # scripts 與依賴
```

---

## Phase 進度（多人連線 × 帳號存檔路線圖）

> 狀態圖例：✅ 已完成並合併；🟦 待驗收；📐 規格已定、待實作；⬜ 待細化／待開工。
>
> 完整規格與驗收標準見 [`docs/multiplayer-spec.md`](docs/multiplayer-spec.md) 第 9 節。

| Phase | 狀態 | 概要 |
|---|---|---|
| **P1 帳號＋存檔（單人）** | ✅ | PR #1（`0ef1c99`）；Google ID Token 登入、D1 schema、角色 CRUD（上限 8）、雲端存檔與 `base_version` 衝突處理、`max_depth` 起始層數、大廳難度灰字 |
| **P2 倉庫** | ✅ | PR #2（`d04e527`）；城鎮倉庫寶箱與視窗 UI、背包 ↔ 倉庫移動／篩選／排序、200 格上限跨局保留 |
| **P3 死亡改版（單人）** | ✅ | PR #3（`f687a02`）；倒地狀態原地開個人傳送門（`hero.portal`）、按按鈕扣金幣回城（不足扣到 0）、死亡不再結束本局；地城清空才重生怪物 |
| **P4-A `Hero` 實體抽出** | ✅ | PR #4（`9895df0`）；新增 `Hero` 類別收容所有每英雄狀態與純規則，引擎改為操作單一 `Hero` 物件 |
| **P4-B 多英雄與 Bot 隊友** | ✅ | PR #5（`32a783a`）；引擎改為 `heroes[]` + `localHeroId`、`?bots=N`（0–3）本機 bot 隊友、按住 `F` 救援倒地隊友、個人掉寶（`ownerId`）、依人數縮放怪物血量／數量 |
| **P4-C 城鎮場景分離** | ✅ | PR #6（`518d4df`）；城鎮與地城分離為同 Scene 兩組 Group + `LevelCtx`；本地英雄回城時若地城仍有活著隊友則持續背景模擬（`bgSim`）、不重生怪物；城鎮傳送門可選任一隊友之門 |
| **P5-A 房間基礎設施** | ✅ | PR #7（`01883f5`）；`workers/room` SQLite DO（WebSocket Hibernation）、`POST /api/rooms` 與 `/api/rooms/:code/ws` 驗證代理、大廳（單人／開房／房號加入）、房間大廳（成員／職業／層數／延遲／聊天）、房主離開即關房、`dev1`～`dev8` 多開發帳號；單人完全不連線 |
| **P5-B 多人地城即時同步** | ✅ | PR #8（`9585c7a`）；新增 `shared/game.ts`、DO 啟用 `startGame`（開局鎖房 409）與 `relay`（分角色大小 32 KB 與速率上限）、種子地城、房主權威模擬＋15 Hz 增量快照、隊友遠端模式＋110 ms 插值＋本地移動預測與校正、各自掉寶、城鎮最小交接（`tw`/`handback`）；4 人實測約 3,900 次 DO 請求／小時 |
| **P5-C 城鎮與位置同步** | ✅ | PR #9（`a0da27a`）；DO 新增 `townPos` 直接扇出（5 Hz 有移動才送、260 ms 插值、模型與名牌）、隊伍狀態 `st`、凍結前補送快照（`mpHostFreezeFlush`）、地城凍結時隊友先行回地城免等房主（背景重建 `mpHostRebuildAway`）、進城等待畫面與 10 秒逾時取消（`hbc`/`hbx`）、木箱本機視覺預測、右上角隊伍面板與遊戲內聊天 |
| **P6 城鎮交易** | ✅（已合併，待雙瀏覽器驗收） | Room Worker 綁 D1；DO 仲裁交易（`tradeReq`／`tradeOffer`／`tradeConfirm` 等，遺物內容一律由 DO 從 D1 讀）；單一 D1 batch（含版本守門，任一語句失敗整批回滾）寫雙方存檔與 `trades` 紀錄、`save_version` +1；客戶端交易前 flush＋鎖定、結果以伺服器存檔覆蓋。規格 §7.1 |
| **P7 中途加入／重連＋打磨** | ✅（merge `43c0e9d`，待雙瀏覽器驗收） | 已開始的房間可中途加入（城鎮出生，無門時出生在本層入口）、成員自動重連（退避 30 秒窗口，以新加入者身分回城鎮）、房主 15 秒寬限與 resume token 接管、自適應插值延遲、`POST /api/rooms` 每帳號 10 分鐘 5 次限流（D1 migration `0002`）。規格 §5.1.4 |

---

## 開發與驗證命令速查

```powershell
# 型別檢查（同時檢查前端、functions/ 與 workers/room/）
npm run lint

# 前端生產建置
npm run build

# 本機 D1 套用 migration（首次或新增 migration 時）
npm run db:migrate:local

# 本機完整三開（Room Worker :8787 + Pages API :8788 + Vite :3000）
npm run dev:full

# 只跑前端（無後端 API，無法登入）
npm run dev

# 部署獨立 Room Worker（修改 workers/room/** 或 shared/room.ts 後必跑）
npm run deploy:room
```

- **本機開發登入**：於專案根目錄建立 `.dev.vars` 寫入 `DEV_AUTH=1`（已 gitignore）；開啟 `http://localhost:3000` 可選 `dev1`～`dev8`（或以 `/?devuser=dev2` 預選），模擬多人請開無痕視窗或不同瀏覽器設定檔。
- **本機多英雄 Bot 測試**：單人大廳可直接選 0～3 個 bot 與職業；開發時網址加上 `?bots=1`～`?bots=3` 仍可強制覆寫數量（bot 不存檔、不打 API）。

---

## 文件索引

| 文件 | 職責 | 何時讀 |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | 專案規則、修改／驗證授權、實作守則與工具入口 | 新 session 開場必讀 |
| [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md)（本檔） | 進度快照、命令速查與文件導覽 | 新 session 開場必讀 |
| [`docs/multiplayer-spec.md`](docs/multiplayer-spec.md) | 多人連線、帳號存檔、死亡／傳送門、縮放、交易、P1～P7 路線圖與 §10 待決項 | 實作或討論 P5-B～P7 或共用規則時按章節查閱 |
| [`docs/mage-spec.md`](docs/mage-spec.md) | 冰雪法師完整規格（攻擊循環、技能、護盾、升級、遺物） | 修改法師機制、平衡或遺物互動時查閱 |
| [`docs/hunter-spec.md`](docs/hunter-spec.md) | 亞馬遜獵人完整規格（弓箭普攻、疾步、戰寵召喚／強化與生命週期、升級、遺物特例、HUD 與多人同步） | 修改獵人或戰寵機制、平衡或遺物互動時查閱 |
| [`docs/p1-setup.md`](docs/p1-setup.md) | Google OAuth、D1 建立與 migration、Pages 設定與本機開發 | 設定環境、除錯登入／存檔 API 時查閱 |
| [`docs/p5-setup.md`](docs/p5-setup.md) | Room Worker 部署順序、本機三開開發、多開發帳號與 DO 免費額度估算 | 設定／部署房間後端或設計 P5-B 流量上限時查閱 |

---

## 近期動態與下一步

- **自選起始層與單人 bot 選項（分支 `feat/start-depth-bots`）**：`maxDepth > 1` 的角色可在單人大廳／房間大廳（房主）以滑桿自選 1～`maxDepth` 的起始層（預設最深層）；選擇只留在房主／單人客戶端（`restartRun(..., startDepth)`、`MpConfig.startDepth`），引擎再 clamp，**不改協定、不改 D1、不需 `npm run deploy:room`**，起始較淺不會降低 `max_depth`。單人大廳也能選 0～3 個 bot 並各自指定職業（存 `localStorage`）：bot 等級 = 玩家升級總數並依該職業祭壇選項輪流平均分配（滿上限讓給其他）、遺物數值加成為玩家的 80%（`Hero.relicScale`；傳說特效與四件套光環不可縮放、照常生效）、玩家升級或換裝即時同步；bot 不存檔、不打 API、不開房。`?bots=N` 保留為開發覆寫。規格見 `docs/multiplayer-spec.md` §5.1、P4-B 備註與 §10。
- **城鎮佈局微調（`16d69fb`，直接提交 `main`）**：商店 (8,17)→(9,17)、祭壇 (11,20)→(11,19)、倉庫寶箱 (18,20)→(17,18)，座標集中為 `TOWN_SHOP_GRID`／`TOWN_ALTAR_GRID`／`TOWN_STASH_GRID`。
- **P7 中途加入／重連＋打磨（已合併 `main`，待驗收）**：DO 不再因開局拒絕加入（移除 409 `game_started`），`welcome.started` 讓加入者略過房間大廳；房主引擎對中途加入者建英雄並送 `tw`（新增選用欄位 `st` 帶隊伍狀態），無門可走時以合成 `handback`（`entrance`）走既有路徑放到本層 room 0。成員斷線由 `RoomClient.reconnect()` 退避重連（1/2/4/8 秒、30 秒窗口）並重新抓雲端存檔後當作中途加入者重進。房主斷線進 15 秒寬限（`meta.hostGoneUntil` + DO alarm、`hostState` 訊息、`resumeToken` 經 `x-ev-resume`），同頁面回來即接管並重送 `level`；重新整理或逾時照舊 `roomClosed`。插值延遲改為依到達 jitter 在 110–220 ms（城鎮 260–420 ms）自適應，無新訊息。建房限流 429 `room_create_limited`（`migrations/0002_room_creates.sql`）。本機以 `wrangler dev` + `pages dev` 加 Node WebSocket 腳本實測了 DO 與限流路徑；**尚未做雙瀏覽器端到端驗收（中途加入者走傳送門／出生入口、重連覆蓋層、房主接管後的畫面）**。**部署：`npm run db:migrate:remote` → Pages → `npm run deploy:room`，見 `docs/p5-setup.md`。**
- **P6 城鎮交易（已合併 `main`，待驗收）**：Room Worker 新增 D1 binding `DB`，`VerifiedIdentity` 新增 `characterId`；DO 新增 `townState`、`tradeReq`／`tradeAccept`／`tradeOffer`／`tradeConfirm`／`tradeCancel` 與伺服器 `tradeWait`／`tradeRequest`／`tradeOpen`／`tradeUpdate`／`tradeError`／`tradeEnd`／`tradeDone`（交易草稿只放記憶體；任一方改提供即重置雙方確認；`rev` 防止確認到已過期的版本）。執行時讀雙方 D1 存檔，經純函式 `applyTrade`（`shared/trade.ts`）驗證後以單一 D1 batch 寫兩個存檔與 `trades` 紀錄，並用 `changes()` 守門語句讓版本不符時整批回滾（已用本機 D1 與本機 Room DO 實測）。客戶端：隊伍面板「交易」按鈕、邀請提示、`TradeModal`；交易前 `SaveManager.beginTrade()` flush 並暫停上傳、引擎 `setTradeLock` 鎖背包／金幣／倉庫；結果以 HTTP 取新存檔覆蓋（倉庫不經 WebSocket）。`dev:room`／`dev:api` 皆加 `--persist-to .wrangler/state` 讓本機 D1 共用。**部署：`npm run deploy:room` 與 Pages 需一起更新。** 尚未做雙瀏覽器端到端手動驗收。

- **亞馬遜獵人（`8520060`，直接提交 `main`）**：新增第三職業 `hunter`。遠程單體弓箭普攻（基礎間隔 0.28 s、無三段循環）、天生 20% 爆擊、1.2 倍移速、Shift 疾步；右鍵召喚隨機戰寵（熊／陸行鳥／狼，血量比照同層菁英、脫戰回血、換層跟隨、回城收起），已有戰寵時改為 5 秒強化並回 50% 血。祭壇升級 `hp`／`atk`／`atkSpeed`／`crit` 共 60 次（`shared/character.ts` 新增 `atkSpeed` 欄位，舊存檔讀取時補 0）；左上角戰寵 HUD；多人以 `SnapshotPayload.pets` 同步戰寵，未改 Room DO 與 `shared/room.ts`，不需重新部署 Room Worker，但需部署 Pages 後端才接受建立獵人角色。規格見 [`docs/hunter-spec.md`](docs/hunter-spec.md)。
- **平衡調整（`3ff73a3`、`cdb7369`）**：戰士藥水回復 1.5 倍、菁英攻速 1.25 倍與攻擊距離 1.4 倍、菁英掉寶文字更清楚；戰士與冰雪法師祭壇升級對齊為總計 60 次（攻擊 20、爆擊 15、戰士 HP 20×12）。
- **P5-C（PR #9，`a0da27a`）**：完成城鎮位置同步與多人進出流程。Room DO 新增 `townPos` 直接廣播給其他成員（不經房主，省一半傳入計費），客戶端 5 Hz 有移動才送、接收端以 260 ms 插值畫出城鎮內隊友模型與名牌；新增房主 `st` 隊伍狀態同步、凍結前補送最後快照／私有狀態（`mpHostFreezeFlush`）；地城凍結時任一隊友回地城不再卡等房主，房主於背景重建該層（`mpHostRebuildAway`）；補上進地城等待畫面與 10 秒逾時取消（`hbc`/`hbx`）、修正 `leaveTownScene` 誤拉隊友問題、加入隊友木箱本機視覺預測、右上角隊伍狀態面板與遊戲內 Enter 聊天。Room Worker 已部署更新。
- **P5-B（PR #8，`9585c7a`）**：完成多人地城即時同步。新增 `shared/game.ts` 定義量化（×100）JSON 遊戲訊息協定（`loadout`、`abort`、`level`、`s`、`priv`、`in`、`cmd`、`tw`、`handback`）；Room DO 實作 `startGame`／`gameStarted` 開局鎖房（新加入者 409）並開啟 `relay` 轉發與分角色大小（32 KB）／token bucket 上限；引擎新增房主模式與隊友遠端模式（種子地城、15 Hz 增量快照、110 ms 插值、本地移動預測與 `echoT` 校正、冰錐命中怪物視覺同步、城鎮最小交接，倉庫不上網）；headless Chrome 4 人實測約 3,900 次 DO 請求／小時。
- **P5-A（PR #7，`01883f5`）**：完成多人房間基礎設施。建立獨立 Worker `ember-vault-room` 與 SQLite Durable Object `Room`（WebSocket Hibernation、`setWebSocketAutoResponse` 保活、房主斷線即關房）；Pages Functions 實作 `POST /api/rooms` 與 `/api/rooms/:code/ws` 驗證代理；前端完成大廳、房間大廳（成員、職業、層數、RTT 延遲、聊天）與 `dev1`～`dev8` 多開發帳號登入。
- **P4-C（PR #6，`518d4df`）**：城鎮與地城分離為同一個 `THREE.Scene` 內的兩組 Group，關卡欄位打包成 `LevelCtx`；本地英雄回城時若地城仍有活著的隊友，地城會在背景持續模擬（`bgSim`）且不重生怪物；城鎮傳送門列出同層所有英雄的門。
- **P4-B（PR #5，`32a783a`）**：引擎改為 `heroes[]` + `localHeroId`，支援 `?bots=N` 本機 bot 隊友、按住 `F` 3 秒救援、個人 `ownerId` 掉寶與依人數縮放怪物血量（+100%/人）及數量（+10%/人）。
- **P4-A（PR #4，`9895df0`）**：抽出 `Hero` 類別取代引擎內數百個單英雄欄位。
- **P1～P3（PR #1～#3，`0ef1c99`、`d04e527`、`f687a02`）**：完成 Google 登入、D1 雲端存檔與 8 角色管理（P1）、200 格城鎮倉庫（P2）、倒地原地開門與死亡不結束本局（P3）。

### 下一步
1. **P6 城鎮交易驗收**：兩個瀏覽器帳號實測交易 UI、取消／斷線／離開城鎮路徑與重新載入後的存檔；通過後合併並部署（`npm run deploy:room` 與 Pages 一起）。
2. **後續階段與待決項**：P7 中途加入／斷線重連與延遲補償打磨；待決項詳見 [`docs/multiplayer-spec.md`](docs/multiplayer-spec.md) §10（難度系統內容、自選較淺起始層、房主轉移、公開配對、伺服器端防作弊驗證）。
