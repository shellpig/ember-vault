# `engine.ts` 拆檔重構計畫

本文件是 `src/game/engine.ts` 拆檔重構的施工規格。分支：`refactor/engine-split`。

## 0. 目標與原則

- `engine.ts`（約 14,600 行、一個 `EmbervaultEngine` 類別、約 90 個欄位、278 個方法）拆成多個依功能分的檔案，單檔目標 ≤ ~1,250 行，`engine.ts` 本體 ≤ ~1,000 行。
- **R0～R4 完全不改遊戲行為**：方法內容逐字搬移（只允許：移除 `private` / `protected` 修飾字、調整縮排、補上明確回傳型別）。任何「順手修 bug／改寫」一律不做，發現問題記在報告裡。
- `App.tsx` 與其他呼叫端不需修改（公開 API 不變）。
- 每個階段：通過驗證（§4）後 commit 並 push 到 `refactor/engine-split`。全部完成並經使用者實玩確認後才合併 `main`。
- 重構期間不要用 Gemini／AI Studio 修改 `engine.ts`（會大量衝突）。

## 1. 做法：方法分檔、狀態留在類別

`engine.ts` 內大量使用「目前演出者 `this.hero`」切換英雄（約 1,100 處），多人、bot、AI 都依賴它，因此**不**把狀態拆給各子系統，而是：

```ts
// src/game/engine/hud.ts
import type { EmbervaultEngine } from '../engine';

export const hudMethods = {
  emitHud(this: EmbervaultEngine): void {
    /* 原方法內容逐字搬入，仍使用 this.xxx */
  },
  // ...
};

// src/game/engine.ts
import { hudMethods } from './engine/hud';

type HudMethods = typeof hudMethods;
export interface EmbervaultEngine extends HudMethods {}   // 宣告合併：型別上看得到搬出的方法
export class EmbervaultEngine { /* 欄位、建構子、主迴圈、公開 API */ }
Object.assign(EmbervaultEngine.prototype, hudMethods);   // 執行期掛回原型
```

- 方法模組只 `import type` 引擎，避免執行期循環相依。
- 欄位與被跨檔呼叫的方法需拿掉 `private`（`private` 只能在類別本體內存取）。可在欄位區加註解說明「僅供引擎內部模組使用」。
- 若出現型別循環推導錯誤（implicitly has type any … referenced in its own initializer），替相關方法補上**明確回傳型別**。
- 模組層級共用常數與暫存物件（`_projVec` 等）移到 `engine/scratch.ts` 等檔案並 import，不得複製成兩份。
- 公開方法（`App.tsx` 用到的）可以留在 `engine.ts`，也可以搬出；搬出時一樣靠宣告合併維持型別。

> R0 若證實此模式在 TypeScript 7／Vite／Cloudflare 建置上不可行，停下回報，改採保守方案：只做 R1，並把多人程式拆成獨立類別。

## 2. 目標檔案配置（`src/game/engine/`）

| 檔案 | 內容 | 約略行數 |
|---|---|---|
| `engine.ts`（原位置） | 欄位、建構子、`update` 主迴圈、公開 API、組裝 | ~1,000 |
| `engine/data.ts` | Boss 設定／輪替、菁英名、怪物種類判斷函式（純資料／純函式） | ~320 |
| `engine/entities.ts` | 引擎內部型別：Enemy / Projectile / Pet / Loot / LevelCtx / Mp* 等 interface | ~300 |
| `engine/scratch.ts` | 共用暫存向量與小常數 | ~20 |
| `engine/party.ts` | actor 切換、LevelCtx 切換、bot 建立／裝備／名牌、救援 | ~550 |
| `engine/scene.ts` | 渲染器／場景初始化、粒子、環境更新、牆遮擋、afterDraw、攝影機 | ~800 |
| `engine/levelBuild.ts` | `buildLevel`、`clearLevel`、地城氛圍 | ~1,000 |
| `engine/town.ts` | `buildTown`、`clearTown`、`leaveTownScene`、城鎮氛圍 | ~470 |
| `engine/spawn.ts` | `spawnEnemies`、`addEnemy`、深度縮放函式 | ~450 |
| `engine/input.ts` | 事件綁定、手動控制、輸入鎖、游標朝向 | ~250 |
| `engine/travel.ts` | 傳送門、回城／回地城、死亡回城、天使祝福、`restartRun` | ~500 |
| `engine/economy.ts` | 祭壇升級、藥水購買、商店、倉庫、遺物裝備／販賣 | ~600 |
| `engine/heroCombat.ts` | 喝藥、衝刺、普攻、劍柄重擊、命中、緩速／冰凍、`damageHero` | ~1,200 |
| `engine/classSkills.ts` | 法師／獵人攻擊、冰霜新星、閃現、戰寵、英雄投射物 | ~950 |
| `engine/loot.ts` | `killEnemy`、掉寶、遺物掉落、撿取、自動換裝、符文 | ~800 |
| `engine/hud.ts` | `emitHud`、小地圖、橫幅、飄字、結算 | ~250 |
| `engine/movement.ts` | 碰撞、滑動、尋路、脫困、自動衝刺 | ~350 |
| `engine/ai.ts` | `runAI`、法師戰鬥 AI、stuck recovery、救援步驟、bot 跟隨／歸隊 | ~1,250 |
| `engine/frame.ts` | `updateHeroFrame`、背景模擬、目標進度 | ~450 |
| `engine/enemies.ts` | 怪物 AI、Boss、遠程怪、怪物投射物 | ~1,100 |
| `engine/mp/host.ts`、`mp/guest.ts`、`mp/town.ts` | 多人（`mp*` 方法） | ~900 / ~1,100 / ~400 |

配置為建議值；實作時可依實際相依關係微調（例如某方法更適合放鄰近模組），但要在報告中說明。

## 3. 階段

| 階段 | 內容 | 完成條件 |
|---|---|---|
| **R0 試做與工具** | 撰寫搬移比對腳本（§4.1）；只搬 `hud.ts` 驗證宣告合併＋原型掛載模式 | §4 全部通過 |
| **R1 純資料與型別** | `data.ts`、`entities.ts`、`scratch.ts`（不需掛載模式） | §4 全部通過 |
| **R2 多人** | `mp/host.ts`、`mp/guest.ts`、`mp/town.ts` | §4 全部通過，含多人實跑 |
| **R3 其餘模組** | 依 §2 逐一搬移，一個模組一個 commit | §4 全部通過 |
| **R4 文件** | 更新 `AGENTS.md`（Layer 3 檔案對照、單一事實來源表）與 `PROJECT_BRIEF.md`（目錄結構、近期動態）；本文件標記完成狀態 | 使用者實玩確認後合併 `main` |
| **R5 拆超大函式（選做，另開階段）** | `buildLevel`、`runAI`、`updateBoss`、`killEnemy` 內部拆步驟。會改變函式內部結構，§4.1 不適用，需以實跑驗證 | 另行規劃 |

## 4. 驗證（每階段都要做）

### 4.1 搬移比對（R0～R3 的核心保證）
- 腳本以重構前的 `engine.ts`（`main` 上的版本）為基準，抽出每個方法的「名稱＋內容」，再從新的 `engine.ts` 與 `src/game/engine/**` 抽出同名方法。
- 正規化：去除每行前後空白、移除 `private`／`protected`／`public` 修飾字、移除 `this: EmbervaultEngine` 參數、將 `name(` 方法宣告與物件方法語法統一。
- 必須：方法集合完全相同（無遺失、無新增，除非是報告中列明的組裝程式），每個方法正規化後的內容完全一致。
- 腳本放 `scripts/verify-engine-split.mjs`（無外部相依的 Node 腳本），可提交進 repo 供 R5 前後重複使用。

### 4.2 型別與建置
- `npm run lint`（前端、`functions/`、`workers/room/` 三份 tsconfig）、`npm run build`、`bun install --frozen-lockfile`（不得改動 `bun.lock`／`package.json`）。

### 4.3 單人實跑
- 以 Vite 啟動前端，無介面 Chrome 開 `/?bots=3`（attract mode，自動駕駛＋3 bot）跑 2～3 分鐘：0 個 pageerror、層數有前進、有擊殺與掉寶；截圖存證。

### 4.4 多人實跑（R2 起每階段，至少 R2 與 R3 完成時）
- `npm run dev:full`（`DEV_AUTH=1`），兩個獨立瀏覽器 context（dev1／dev2）：開房、加入、開始遊戲、地城中同步、回城、回地城；R2 與 R3 結束時加跑一次城鎮交易。可沿用 `/tmp/ev-e2e/` 的既有腳本。

## 5. 完成狀態

- [x] R0（另含 `scratch.ts`，因 `hud.ts` 用到共用暫存向量）
- [x] R1
- [x] R2（`mp/` 另分出 `core.ts`，共 4 檔）
- [x] R3（`findNearbyDungeonPortal` 因預設參數 `= this.hero` 造成 TS 循環推導而留在 `engine.ts`）
- [x] R4（待使用者實玩確認後合併 `main`）
- [ ] R5（選做）
