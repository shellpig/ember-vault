# 多人連線 × 帳號存檔 規格書

開房間、最多 4 人合作、Google 登入、角色雲端存檔（跨局保留）。
本文件是設計的單一來源；數值有變動時以此為準並同步更新。

---

## 0. 總覽與已定案決策

| 項目 | 決定 |
|---|---|
| 人數 | 1–4 人合作（單人 = 只有自己的本機遊戲，**不建立房間、不連 Durable Object**，不消耗連線額度；引擎邏輯與多人共用 `heroes[]`） |
| 連線架構 | **房主權威**：房主瀏覽器跑地城模擬；其他人送輸入、收快照。Cloudflare **Durable Object** 當房間與 WebSocket 轉發 |
| 城鎮 | **各客戶端本機模擬**，房主只模擬地城 |
| 選遺物 | 各自選、**不暫停** |
| 掉寶 | 各自看各自的（loot 有 `ownerId`） |
| 交易 | 只能在城鎮、同房玩家之間；伺服器端原子完成 |
| 死亡 | 倒地 → 原地開傳送門；可被隊友救起；按按鈕才回城（扣傳送門金幣） |
| 傳送門 | **每位玩家各自一個**；**任何人都能走別人的門** |
| 全員回城 | 地城**不結束**，凍結保留 |
| 房主離開 | 房間直接結束（第一版不做房主轉移） |
| 中途加入 | 允許；一律出生在城鎮 |
| 難度縮放 | 怪物血量 +100% / 每多一人；數量 +10% / 每多一人 |
| 登入 | Google（Google Identity Services ID token） |
| 存檔 | Cloudflare D1；跨局保留 **金幣、遺物（裝備中＋背包＋倉庫）、金幣升級、最高到達層數** |
| 角色 | 一帳號多角色（上限 8），職業隨角色固定 |
| 起始層數 | = **房主角色的最高到達層數** |
| 難度選擇 | 保留功能，UI 顯示為灰字「即將推出」 |

---

## 1. 帳號與角色

### 1.1 Google 登入流程

1. 前端載入 Google Identity Services，顯示「使用 Google 登入」按鈕。
2. 玩家登入後前端取得 **ID token**（JWT）。
3. 前端 `POST /api/auth/google { credential }`。
4. Pages Function 用 `jose` 的 `createRemoteJWKSet('https://www.googleapis.com/oauth2/v3/certs')` 驗證簽章，並檢查：
   - `aud` == 我們的 Client ID
   - `iss` ∈ { `accounts.google.com`, `https://accounts.google.com` }
   - `exp` 未過期
5. 以 `sub`（Google 使用者唯一 ID）查 / 建 `accounts`。
6. 產生隨機 session token（32 bytes），**DB 只存 SHA-256 雜湊**，回傳 cookie：
   `Set-Cookie: ev_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
7. 之後所有 `/api/*` 都靠這個 cookie 驗證；`POST /api/auth/logout` 刪 session。

前置作業：Google Cloud Console 建 OAuth Client ID（Web），授權 JavaScript 來源加入正式網域、`*.pages.dev` 預覽網域、`http://localhost:3000`。Client ID 放在 `wrangler.toml` 的 `[vars]`（`GOOGLE_CLIENT_ID`，公開值），前端由 `GET /api/config` 取得。

### 1.2 角色

- 每個帳號最多 **8** 個角色。
- 建角色時選職業（戰士 / 冰雪法師 / 第三格灰字），**之後不能換**。
  → 取代 `mage-spec.md` §0「每局選職業」：改為「選角色」。
- 角色可刪除（二次確認）。

### 1.3 跨局保留的內容

| 欄位 | 說明 |
|---|---|
| `gold` | 金幣 |
| `upgrades` | 金幣升級：`hp` / `atk` / `armor` / `crit` / `hpShield` / `shieldSpeed` 各自等級（對應現有 `*Upgrades` 欄位） |
| `equipped` | 裝備中遺物（4 格） |
| `bag` | 背包遺物（上限 30，同現有 `relicBagCap`） |
| `stash` | **倉庫遺物（上限 200）— 新功能** |
| `maxDepth` | 曾經到達的最高層數 |
| `potions` | 身上的藥水數量（新角色預設 3；不再每局重置為 3） |

**不保留**（每次進地城重置）：天使祝福、當層狀態、傳送門位置。

### 1.4 倉庫（新功能）

- 城鎮新增一棟建築 / NPC「倉庫」，靠近按互動鍵開啟。
- 容量 200；可在 背包 ↔ 倉庫 間移動、在倉庫內排序 / 篩選稀有度 / 篩選套裝。
- 只能在城鎮使用。

---

## 2. 開局流程

```
登入 → 選角色 / 建角色 → 大廳（單人開始 / 建立房間 / 輸入房號加入）→ 城鎮 → 傳送門 → 地城
```

- **起始層數** = 房主角色的 `maxDepth`（新角色 = 1）。
- 加入者的 `maxDepth` 比房主低也照樣進入房主的層數；到達更深層時，每個人各自更新自己的 `maxDepth`。
- 大廳顯示「難度」選單，灰字＋「即將推出」，不可操作。
- attract mode（自動模式背景）保留在登入 / 選角畫面後方。

---

## 3. 死亡與傳送門（單人、多人共用）

### 3.1 傳送門

- 每位玩家各有**一個**傳送門位置 `hero.portal: {x, z, depth} | null`（取代現在的單一 `townPortalPos`）。
- 開新門會取代自己的舊門。
- 任何玩家都能走任何人的門（地城 → 城鎮）。
- 從城鎮回地城：城鎮傳送門列出所有可用的門（自己的 + 隊友的），選一個出去。
- 換層時所有人的門都清除。

### 3.2 一般回城

- 維持現有 `returnToTown()` 行為：扣 `getTownReturnCost()`（= `depth * 10`），在腳下開門。

### 3.3 倒地

1. `hp <= 0` → 進入 **倒地（downed）** 狀態：倒地姿勢、不能行動、怪物不再鎖定此玩家。
2. **原地開啟該玩家的傳送門**（取代舊門）。
3. 顯示跟現在一樣的死亡畫面，但按鈕是「**回到城鎮**」。
4. 玩家按下按鈕 → 扣傳送門金幣 `depth * 10`，**金幣不夠就扣到 0** → 傳送回城鎮，HP 回滿。
5. **被救起**：隊友站在倒地者旁（半徑 1.5）按住互動鍵 **3 秒**（受到傷害會中斷進度）
   → 倒地者**滿血**原地復活，死亡畫面**自動關閉**，不扣金幣。原地的傳送門保留。
6. 單人模式：沒有人能救，只能按按鈕回城。**死亡不再結束這一局。**

### 3.4 全員回城

- 地城裡沒有活著的玩家時，房主引擎**凍結地城**（沿用現有 `SavedDungeonSnapshot`；觸發條件從「我回城」改成「最後一個人離開地城」）。
- 有人再從門回到地城時解凍。
- 倒地者不算「在地城裡」：全員倒地 = 地城凍結，每個人在自己的死亡畫面上按回城。
- **怪物重生規則**：
  - 只要地城裡還有活著的玩家，有人回城／倒地回城**不會**讓怪物重生，地城持續運作。
  - 地城清空（最後一個活著的玩家離開）後，下一次有人從門回來時，本層怪物**重新生成**（沿用單人現有行為：地圖、鑰匙、門、已用符文井、已破木箱、擊殺數保留，Boss 依 `portalSafePos` 移離門口）。
  - 單人模式即 n = 1 的特例：回城 = 地城清空 → 回來時怪物重生（P3 已是此行為）。

---

## 4. 難度縮放

設 `n` = 房間內玩家數（含在城鎮的人）。

- 怪物血量倍率 = `1 + (n - 1) * 1.0`（2 人 2 倍、4 人 4 倍）
- 怪物數量倍率 = `1 + (n - 1) * 0.1`（4 人 1.3 倍，向下取整後至少 +1 隻才算）
- Boss / 菁英同樣套用血量倍率。
- **數量的實作方式（P4-B）**：生成完一層的所有怪物後，以「該層非 Boss 怪物總數」計算額外隻數 `floor(總數 × (n−1) / 10)`，再依序輪流分配到各戰鬥房間（每隻是一般怪，隨機落點）。這樣即使每個 pack 都很小，整層也確實會多出幾隻（例：28 隻的樓層，2 人 +2、4 人 +8）；n = 1 時完全不多生，數值與單人相同。
- **生效時機**：生成怪物時依當下的 `n` 計算；有人中途加入或離開時，已存在怪物的血量依比例重算（保留血量百分比），數量則從下一層開始生效。

---

## 5. 連線架構

### 5.1 元件

```
[房主瀏覽器] ──WS──┐
[玩家 B]     ──WS──┼── Durable Object「Room」（一房一個） ── D1
[玩家 C/D]   ──WS──┘
```

- **Room DO**：房號（6 碼英數，排除易混淆字元）、成員名單、轉發訊息、交易仲裁（見 §7）。不跑遊戲邏輯。
- **房主**：跑地城模擬（現在的 engine），每 50ms（20 Hz）送快照。
- **其他玩家**：每個 frame 收集輸入，以 30 Hz 送出；畫面以快照插值（延遲約 100ms 緩衝）＋本機英雄移動預測。

### 5.2 訊息（JSON，日後可換 binary）

| 方向 | type | 內容 |
|---|---|---|
| C→S | `join` | `characterId` |
| S→C | `welcome` | `playerId`、成員、是否為房主、目前地城完整狀態（若有） |
| C→房主 | `input` | `seq`、移動向量、瞄準方向、按鍵（攻擊 / 衝刺 / 技能 / 藥水 / 互動） |
| 房主→C | `snapshot` | `tick`、heroes[]、enemies[]、projectiles[]、loot[]（含 `ownerId`）、門 |
| 房主→C | `event` | 傷害數字、音效、特效、橫幅（不需重送，掉了就算） |
| C→房主 | `location` | 進城 / 出城（選了哪扇門） |
| C→C（經 S） | `townPos` | 城鎮內位置（5 Hz） |
| S→C | `memberLeft` / `roomClosed` | 有人離開 / 房主離開 → 房間結束 |

- 客戶端依 `ownerId` 過濾 loot，只畫自己的。
- 撿取遺物：房主判定撿到 → 對該玩家發 `event: lootPicked { relic }`，客戶端放進自己的背包。

### 5.3 中途加入

- 新玩家一律出生在**城鎮**，從城鎮傳送門選隊友的門進入。
- 如果沒有任何門可走（全員都在地城、沒人開門），改為出生在**該層入口（room 0）**。
- 斷線重連 = 同一個角色再 `join` 一次，走同一套流程。

---

## 6. 引擎重構：單一英雄 → `heroes[]`

現在 `EmbervaultEngine` 用 `heroX`、`hp`、`gold`、`equippedRelics`… 等數百個欄位代表**唯一**英雄。

- 新增 `Hero` 類別（或 interface + 函式），收容：位置 / 速度、HP / 護盾、職業 / rig、冷卻、升級等級、遺物（裝備中 / 背包）、遺物統計、金幣、藥水、倒地狀態、傳送門、輸入狀態。
- 引擎改為 `heroes: Hero[]` + `localHeroId`。
- 敵人 AI 鎖定**最近的非倒地英雄**。
- 攝影機、HUD、輸入只綁 `localHeroId`。
- `updateAI()`（attract mode）改為能驅動任一英雄 → **拿來當 bot 測試多英雄**，不需要網路就能驗證。
- 城鎮場景從地城引擎分離成獨立的 `TownScene`，在客戶端本機運行。

**P4-B 實作備註**
- engine 持有 `heroes: Hero[]` + `localHeroId`；`engine.hero` 是「目前被處理的英雄（actor）」，在每位英雄的迴圈中以 `setActor()` 切換，迴圈外一律等於本地英雄。攝影機、HUD、小地圖、輸入、死亡畫面、存檔只綁本地英雄。
- 網址參數 `?bots=N`（0–3，預設 0）加入本機 bot 隊友；bot 永遠不存檔、不打 API。

**P4-C 實作備註**
- 城鎮與地城是同一個 `THREE.Scene` 內的兩組 Group（`townGroup` vs `levelGroup`／`dynamicGroup`／`debrisGroup`），只有本地英雄所在那組 `visible`，另一組完全不渲染（共用燈光、粒子池、英雄模型與已編譯的 shader）。引擎的「目前關卡欄位」（`dungeon`、`enemies`、`lightProps`…）打包成 `LevelCtx`；本地英雄在城鎮時地城的那組欄位停放在 `dungeonCtx`，背景模擬時暫時換進來（`runDungeonBackground`），模擬期間 HUD、粒子、音效、浮動文字、鏡頭一律不動（`bgSim`）。城鎮每次進入時重建、離開時釋放（純本機）。
- 回城：地城裡還有活著的英雄（bot）→ 地城原樣保留並持續模擬、不重生怪物；否則凍結（存 `SavedDungeonSnapshot`、釋放場景），之後有人從門回來才依 §3.4 重生怪物（所有英雄的門、倒地者位置都保留）。
- 城鎮傳送門列出本層所有英雄的門（自己的排第一），同層才有效；沒有任何門時改從該層入口（room 0）出發。
- 本地英雄不在地城時，bot 在本地英雄離開的位置（錨點）待命：半徑約 3 內站位；只迎戰錨點 8 內的敵人，被拉離錨點超過 10 就放棄目標回錨點；不撿遠處東西、不探索、不踩樓梯；只救錨點 10 內的倒地隊友。本地回地城後恢復跟隨。
- 換層（隊友踩樓梯，本地在城鎮）：不淡出、所有門清除、地城中的英雄（倒地者滿血）移到新入口、bot 錨點改為新入口，城鎮顯示「隊伍已前往第 N 層」。本地英雄的 `maxDepth` 只在實際進入該層時更新並存檔；城鎮中的存檔（倉庫關閉等）以本地自己的 `maxDepthReached` 為準。城鎮中的英雄不分到該層的掉寶、擊殺與增益層數。

---

## 7. 交易（城鎮、伺服器端原子完成）

1. A 對 B 發起交易（兩人都要在城鎮、同一房）。
2. 雙方各自放入遺物 / 金幣（來源：背包或倉庫）。
3. 任一方修改內容 → 雙方的「確認」都重置。
4. 雙方都確認 → **Room DO** 執行：
   - 從 D1 讀兩個角色的存檔，檢查物品確實存在、金幣足夠、對方空間足夠
   - 用**一個 D1 batch** 同時寫入雙方存檔＋一筆 `trades` 紀錄（全部成功或全部失敗）
   - 兩個角色的 `save_version` 都 +1
   - 把新存檔推給兩個客戶端，客戶端**以伺服器版本取代本機狀態**
5. 防止刷物品：存檔上傳時帶 `base_version`，版本不符就拒絕（見 §8.3）。斷線再讀回舊檔也會因為版本過舊而無法上傳。

---

## 8. 存檔（D1）

### 8.1 資料表

```sql
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,          -- uuid
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT,
  display_name  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,          -- sha256(token)
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  expires_at    INTEGER NOT NULL
);

CREATE TABLE characters (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  name          TEXT NOT NULL,
  class_id      TEXT NOT NULL,             -- 'warrior' | 'frost_mage' | ...
  gold          INTEGER NOT NULL DEFAULT 0,
  max_depth     INTEGER NOT NULL DEFAULT 1,
  potions       INTEGER NOT NULL DEFAULT 3,
  upgrades      TEXT NOT NULL,             -- JSON
  equipped      TEXT NOT NULL,             -- JSON RelicItem[] (≤4)
  bag           TEXT NOT NULL,             -- JSON RelicItem[] (≤30)
  stash         TEXT NOT NULL,             -- JSON RelicItem[] (≤200)
  save_version  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_characters_account ON characters(account_id);

CREATE TABLE trades (
  id            TEXT PRIMARY KEY,
  char_a        TEXT NOT NULL,
  char_b        TEXT NOT NULL,
  payload       TEXT NOT NULL,             -- JSON：雙方交出的東西
  created_at    INTEGER NOT NULL
);
```

### 8.2 API（Pages Functions，全部需要 session）

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/auth/google` | 登入 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/me` | 目前帳號 |
| GET | `/api/characters` | 角色列表（摘要） |
| POST | `/api/characters` | 建角色（檢查上限 8） |
| GET | `/api/characters/:id` | 完整存檔 |
| PUT | `/api/characters/:id` | 上傳存檔（帶 `base_version`） |
| DELETE | `/api/characters/:id` | 刪角色 |

伺服器端驗證：角色屬於本帳號、`bag ≤ 30`、`stash ≤ 200`、`equipped ≤ 4`、`gold ≥ 0`、`potions ≥ 0`。

### 8.3 存檔時機與版本

- **存檔時機**：回到城鎮、換層、交易完成、倉庫操作結束（關閉倉庫視窗時）、離開遊戲（`pagehide` 時用 `navigator.sendBeacon`）。
- 地城中途不存；當機 / 斷線會失去上一個存檔點之後撿到的東西（可接受）。
- `PUT` 時 `base_version` ≠ DB 的 `save_version` → 回 409，客戶端重新拉取。
- 已知限制：存檔由客戶端上傳，有心人可以改。朋友間遊玩可接受；交易由伺服器驗證，至少不會影響對方。

---

## 9. 分階段實作順序

每一階段結束時遊戲都要能正常遊玩。

| 階段 | 內容 | 驗收 |
|---|---|---|
| **P1 帳號＋存檔（單人）** | Google 登入、D1 schema、角色 CRUD、選角畫面、存檔 / 讀檔、`maxDepth` 與起始層數、大廳難度灰字 | 換瀏覽器登入後角色、金幣、遺物、升級都在 |
| **P2 倉庫** | 城鎮倉庫建築＋UI、背包 ↔ 倉庫、200 上限 | 倉庫內容跨局保留 |
| **P3 死亡改版（單人）** | 倒地 → 原地開門 → 按鈕回城扣金幣（扣到 0）、死亡不結束這局、傳送門改為 `hero.portal` | 單人死亡後可回城繼續 |
| **P4 多英雄重構** | `Hero` 抽出、`heroes[]`、敵人鎖定最近者、bot 隊友、救人、難度縮放、城鎮分離成 `TownScene` | 單人＋3 個 bot 能完整打一層、救人可用 |
| **P5 房間＋連線** | Room DO、房號、快照 / 輸入、插值與預測、各自 loot、各自傳送門、城鎮本機模擬＋位置同步、房主離開即結束 | 4 個瀏覽器分頁能一起打 |
| **P6 交易** | 城鎮交易 UI、Room DO 仲裁、D1 batch、`save_version` | 交易後雙方存檔正確，斷線不能刷物品 |
| **P7 中途加入／重連＋打磨** | 進行中加入、斷線重連、延遲補償調整 | 中途加入可直接進地城 |

---

## 10. 待決 / 之後再說

- 難度系統內容（目前只有灰字 UI）。
- 房主是否可以選擇比 `maxDepth` 淺的起始層。
- 房主轉移。
- 公開配對（目前只有房號）。
- 伺服器端完整驗證物品來源（防作弊）。
