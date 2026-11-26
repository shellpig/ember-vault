# Embervault 專案簡報

本文件供新 session 快速了解專案全貌；需要細節時按下方文件索引深入。**本檔是唯一「隨進度持續更新」的文件**（每個階段收尾更新一次）。

最後更新：2026-11-26

> **當前進度**：單人完整玩法（雙職業、40 層四大區域、遺物與套裝、城鎮與倉庫、倒地與傳送門、多英雄引擎與本機 bot 隊友）以及 **Cloudflare 帳號存檔（P1）**、**倉庫（P2）**、**死亡與傳送門改版（P3）**、**多英雄與城鎮場景分離（P4-A／P4-B／P4-C）**、**多人房間基礎設施（P5-A）**、**多人地城即時同步（P5-B）**、**城鎮同步與多人進出流程（P5-C）** 皆已完成並合併至 `main`（`a0da27a`），Room Worker 也已部署更新至 P5-C 版本。目前 1–4 人可完整開房協力打地城、在城鎮互看模型與名牌、全員回城後任一人先行解凍回地城、使用隊伍面板與遊戲內聊天；遊戲開始後鎖房（尚未開放中途加入與自動重連）。**下一步：P6 城鎮交易（城鎮同房玩家交易 UI、Room DO 仲裁、D1 batch 原子寫入與 `save_version` 防刷裝）。**

---

## 專案概述

**Embervault** 是一款 3D 等角視角（Isometric）程序化地城探索動作 RPG，支援 **1–4 人合作**，主打動態提燈陰影、自動探索／戰鬥 AI 與無縫手動操作切換、Web Audio 程序化音效與跨局雲端角色存檔。

- **前端技術棧**：TypeScript + Vite 8 + React 19 + Tailwind CSS 4 + Three.js + Web Audio（`src/`）
- **後端與資料層**：Cloudflare Pages Functions（`functions/`）+ Cloudflare D1 SQLite（`migrations/0001_init.sql`）+ Google Identity Services ID Token 登入（`jose` 驗證、HttpOnly cookie `ev_session`）
- **多人房間架構**：獨立私有 Worker `ember-vault-room`（`workers/room/`）內的 SQLite Durable Object `Room`（WebSocket Hibernation API），透過 Pages `ROOM` binding 代理；採**房主權威**模式（房主跑地城模擬、其他人送輸入收快照；城鎮各客戶端本機模擬；單人模式完全不開房、不連 DO）
- **核心玩法內容**：
  - **雙職業**：燈守戰士（近戰三段連斬、劍柄重擊暈眩、衝刺、護甲）與冰雪法師（三發循環冰尖彈含緩速／爆炸、冰霜新星、閃現、自動回充護盾），第三格預留。
  - **40 層四大區域**：石造地城（1–10）、地下洞窟（11–20）、巨獸體內（21–30）、外星飛船（31–40），各具地形主題、敵人族群、菁英與 Boss。
  - **跨局進度**：每帳號最多 8 角色，雲端保留金幣、金幣升級、最高到達層數（`max_depth`）、藥水、裝備中遺物（4 格）、背包（30 格）與城鎮倉庫（200 格）。

## 目錄結構

```text
.
├── docs/
│   ├── multiplayer-spec.md       # 多人連線 × 帳號存檔規格書（P1～P7 單一來源）
│   ├── mage-spec.md              # 冰雪法師規格書
│   ├── p1-setup.md               # P1 Google OAuth、D1 與本機開發設定指南
│   └── p5-setup.md               # P5-A Room Worker 部署、本機三開與流量預算指南
├── migrations/
│   └── 0001_init.sql             # D1 schema：accounts, sessions, characters, trades
├── shared/                       # 瀏覽器／Pages Functions／Room Worker 共用純 TS
│   ├── character.ts              # 角色存檔型別與數量上限（8 角色 / 4 裝 / 30 包 / 200 倉）
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
│   └── src/index.ts              # Room Durable Object（Hibernation、聊天、ping、預留 relay）
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
| **P6 城鎮交易** | 📐 | 城鎮同房玩家交易 UI、Room DO 仲裁、D1 batch 原子寫入雙方存檔與 `trades` 紀錄、`save_version` 遞增防刷裝 |
| **P7 中途加入／重連＋打磨** | ⬜ | 進行中加入（出生城鎮或入口）、斷線自動重連、延遲補償與建房限流打磨 |

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
- **本機多英雄 Bot 測試**：網址加上 `?bots=1`～`?bots=3` 可在單人模式加入本機 bot 隊友驗證多人戰鬥、救援與進出城鎮（bot 不存檔、不打 API）。

---

## 文件索引

| 文件 | 職責 | 何時讀 |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | 專案規則、修改／驗證授權、實作守則與工具入口 | 新 session 開場必讀 |
| [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md)（本檔） | 進度快照、命令速查與文件導覽 | 新 session 開場必讀 |
| [`docs/multiplayer-spec.md`](docs/multiplayer-spec.md) | 多人連線、帳號存檔、死亡／傳送門、縮放、交易、P1～P7 路線圖與 §10 待決項 | 實作或討論 P5-B～P7 或共用規則時按章節查閱 |
| [`docs/mage-spec.md`](docs/mage-spec.md) | 冰雪法師完整規格（攻擊循環、技能、護盾、升級、遺物） | 修改法師機制、平衡或遺物互動時查閱 |
| [`docs/p1-setup.md`](docs/p1-setup.md) | Google OAuth、D1 建立與 migration、Pages 設定與本機開發 | 設定環境、除錯登入／存檔 API 時查閱 |
| [`docs/p5-setup.md`](docs/p5-setup.md) | Room Worker 部署順序、本機三開開發、多開發帳號與 DO 免費額度估算 | 設定／部署房間後端或設計 P5-B 流量上限時查閱 |

---

## 近期動態與下一步

- **P5-C（PR #9，`a0da27a`）**：完成城鎮位置同步與多人進出流程。Room DO 新增 `townPos` 直接廣播給其他成員（不經房主，省一半傳入計費），客戶端 5 Hz 有移動才送、接收端以 260 ms 插值畫出城鎮內隊友模型與名牌；新增房主 `st` 隊伍狀態同步、凍結前補送最後快照／私有狀態（`mpHostFreezeFlush`）；地城凍結時任一隊友回地城不再卡等房主，房主於背景重建該層（`mpHostRebuildAway`）；補上進地城等待畫面與 10 秒逾時取消（`hbc`/`hbx`）、修正 `leaveTownScene` 誤拉隊友問題、加入隊友木箱本機視覺預測、右上角隊伍狀態面板與遊戲內 Enter 聊天。Room Worker 已部署更新。
- **P5-B（PR #8，`9585c7a`）**：完成多人地城即時同步。新增 `shared/game.ts` 定義量化（×100）JSON 遊戲訊息協定（`loadout`、`abort`、`level`、`s`、`priv`、`in`、`cmd`、`tw`、`handback`）；Room DO 實作 `startGame`／`gameStarted` 開局鎖房（新加入者 409）並開啟 `relay` 轉發與分角色大小（32 KB）／token bucket 上限；引擎新增房主模式與隊友遠端模式（種子地城、15 Hz 增量快照、110 ms 插值、本地移動預測與 `echoT` 校正、冰錐命中怪物視覺同步、城鎮最小交接，倉庫不上網）；headless Chrome 4 人實測約 3,900 次 DO 請求／小時。
- **P5-A（PR #7，`01883f5`）**：完成多人房間基礎設施。建立獨立 Worker `ember-vault-room` 與 SQLite Durable Object `Room`（WebSocket Hibernation、`setWebSocketAutoResponse` 保活、房主斷線即關房）；Pages Functions 實作 `POST /api/rooms` 與 `/api/rooms/:code/ws` 驗證代理；前端完成大廳、房間大廳（成員、職業、層數、RTT 延遲、聊天）與 `dev1`～`dev8` 多開發帳號登入。
- **P4-C（PR #6，`518d4df`）**：城鎮與地城分離為同一個 `THREE.Scene` 內的兩組 Group，關卡欄位打包成 `LevelCtx`；本地英雄回城時若地城仍有活著的隊友，地城會在背景持續模擬（`bgSim`）且不重生怪物；城鎮傳送門列出同層所有英雄的門。
- **P4-B（PR #5，`32a783a`）**：引擎改為 `heroes[]` + `localHeroId`，支援 `?bots=N` 本機 bot 隊友、按住 `F` 3 秒救援、個人 `ownerId` 掉寶與依人數縮放怪物血量（+100%/人）及數量（+10%/人）。
- **P4-A（PR #4，`9895df0`）**：抽出 `Hero` 類別取代引擎內數百個單英雄欄位。
- **P1～P3（PR #1～#3，`0ef1c99`、`d04e527`、`f687a02`）**：完成 Google 登入、D1 雲端存檔與 8 角色管理（P1）、200 格城鎮倉庫（P2）、倒地原地開門與死亡不結束本局（P3）。

### 下一步
1. **P6 城鎮交易**：實作城鎮內同房玩家交易 UI、Room DO 仲裁（讀 D1 驗證物品／金幣／空間）、以單一 D1 batch 原子更新雙方存檔與寫入 `trades` 紀錄、遞增 `save_version` 並推回雙方客戶端覆蓋本機狀態。
2. **後續階段與待決項**：P7 中途加入／斷線重連與延遲補償打磨；待決項詳見 [`docs/multiplayer-spec.md`](docs/multiplayer-spec.md) §10（難度系統內容、自選較淺起始層、房主轉移、公開配對、伺服器端防作弊驗證）。
