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
| 房間後端 | `workers/room/` 獨立 Worker 內的 SQLite Durable Object，不公開；瀏覽器只經 Pages Functions 連線（§5.1.1） |

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
[房主瀏覽器] ──WSS──┐
[玩家 B]     ──WSS──┼── Pages Functions（驗證 session／角色）──binding ROOM──▶ Worker `ember-vault-room`
[玩家 C/D]   ──WSS──┘                                                          └─ Durable Object「Room」（一房一個）── D1
```

- **Room DO**：房號（6 碼英數，排除易混淆字元）、成員名單、轉發訊息、交易仲裁（見 §7）。不跑遊戲邏輯。
- **房主**：跑地城模擬（現在的 engine），每 50ms（20 Hz）送快照（P5-B 起實際值以 §5.2.1 流量預算為準：快照上限 15 Hz）。
- **其他玩家**：每個 frame 收集輸入，以 30 Hz 送出；畫面以快照插值（延遲約 100ms 緩衝）＋本機英雄移動預測。

### 5.1.1 實際架構（P5-A 已實作）

- **獨立 Worker 放 Durable Object**：Pages Functions 不能定義 DO class，所以 `Room` 在 `workers/room/`（Worker 名稱 `ember-vault-room`，**SQLite-backed**，migration `v1` `new_sqlite_classes = ["Room"]`，免費方案只支援這種）。Pages 的 `wrangler.toml` 以 `[[durable_objects.bindings]] name = "ROOM", class_name = "Room", script_name = "ember-vault-room"` 綁定。部署順序與指令見 `docs/p5-setup.md`。
- **DO 不公開**：Worker 沒有 routes、`workers_dev = false`，瀏覽器碰不到。瀏覽器只連 Pages：
  - `POST /api/rooms { characterId }`：需登入；確認角色屬於本帳號；產生 6 碼房號（拒絕取樣，字元表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`）；呼叫 DO `/init` 記錄房主 accountId 與建立時間；碼已被使用（409）就重試，最多 6 次。回傳 `{ code }`。
  - `GET /api/rooms/:code/ws?characterId=...`：需登入；Origin 檢查比照 `_middleware.ts`（帶 Origin 時必須同源，`DEV_AUTH=1` 時略過）；驗證角色屬於本帳號並讀出角色摘要（名稱、職業、`max_depth`）；把驗證過的身分放進內部 header `x-ev-identity`，用 `ROOM.idFromName(code)` 的 stub 轉給 DO。Pages 轉送前會丟掉瀏覽器的 cookie 與所有 `x-ev-*` header，**DO 不信任任何來自瀏覽器的身分欄位**。
  - 沒有 `Upgrade: websocket` 的 GET 是「試跑」：做同樣的檢查但不建立連線，回 200／401／403／404／409，讓前端顯示明確的繁中錯誤（失敗的 WebSocket 握手拿不到 HTTP 狀態碼）。
  - 錯誤碼：未登入 401；角色不屬於本帳號或不存在 403；房號格式錯誤或房間不存在 404；滿 4 人 409；同一帳號重複加入 → **取代舊連線**（沿用原 playerId，舊連線收到 `replaced`）。
- **Hibernation**：`ctx.acceptWebSocket`、`webSocketMessage/Close/Error`、成員資訊用 `serializeAttachment` 存在每條連線上；房間 meta（房主 accountId、建立時間）存在 DO storage。保活用 `setWebSocketAutoResponse`（文字 `ping` → `pong`，不喚醒 DO、不計請求）。
- **房間生命週期**：非房主只能加入「房主已連線」的房間；房主斷線或離開 → 廣播 `roomClosed`、關閉全部連線、`deleteAll()` 清掉狀態（房號可再使用）。建立後 2 分鐘房主沒連上（或連線全消失）→ alarm 清除。
- **限制**：單則訊息 4096 字元（超過 close 1009）；每連線 token bucket（突發 20、每秒補 5，超過 close 1008）；二進位或非 JSON 訊息斷線；聊天 200 字、控制字元轉空白；`from`／`name` 一律由伺服器蓋章。

### 5.1.2 P5-B 實際協定（已實作）

Room DO 不懂遊戲內容，只做轉發（`relay`）＋把房間標記為「已開始」：

- `startGame`（C→S，只有房主）：房間記為 `started`（寫入 DO storage），廣播 `gameStarted`。之後新加入者（不是原本的成員）一律 **409 `game_started`**（前端顯示「遊戲已開始，無法加入（中途加入尚未開放）」）；`welcome.started` 告知已開始。未開始前收到 `relay` 一律忽略。
- `relay`（C→S）`{ type:'relay', kind, payload, to? }`；S→C `{ type:'relay', from, kind, payload }`，`from` 由伺服器蓋章。**房主 → 全體其他人（或 `to` 指定的一位）**；**成員 → 只給房主**（成員填的 `to` 被忽略）。
- 大小與速率依角色分開：房主單則最多 **32768 字元**（快照 / 新樓層），成員一般訊息 4096 字元，只有 `loadout`、`handback` 這兩種可到 32768；超過 close 1009。token bucket：房主 突發 80、每秒補 40；成員 突發 50、每秒補 30（超過 close 1008）。聊天、ping 沿用 P5-A 的規則。
- 為了不超過單則上限，**倉庫（最多 200 件遺物）不會經過網路**：`loadout`、`handback`、`priv` 的 `stash` 一律是空陣列，倉庫永遠留在擁有者自己的瀏覽器，只有擁有者存檔。

#### 遊戲訊息（`relay.kind`，型別定義在 `shared/game.ts`）

| kind | 方向 | 內容 |
|---|---|---|
| `loadout` | 成員→房主 | 開局時送自己的角色（`exportCharacterState` 格式、職業、無倉庫） |
| `abort` | 房主→成員 | 10 秒內沒收到你的 loadout，不帶你開始 |
| `level` | 房主→成員（一人一則） | 新樓層 / 從城鎮回來：`n`（層數）、`seed`（`generateDungeon(depth, seed)` 的種子）、`roster`（所有英雄：id、名稱、職業、位置、是否在城鎮）、完整世界快照、**收件人自己的** `priv`、`fl`（1 = 新樓層） |
| `s` | 房主→全體 | 快照（增量），15 Hz；怪物 / 投射物 / 遺物 / 門 / 世界狀態 / 事件只送「有變化」的 |
| `priv` | 房主→單一成員 | 那位英雄的私有狀態：金幣、藥水、升級、已裝備與背包遺物、天使祝福、統計、倒地原因；**有變化才送**（最快 0.4 秒一次） |
| `in` | 成員→房主 | 輸入：`t`（成員時鐘）、按鍵位元（WASD / F）、朝向 ×100、按住左鍵、一次性動作（攻擊 / 衝刺 / 劍柄重擊或技能 / 藥水）；**有變化才送、最高 20 Hz、沒變化每 1 秒一則 keepalive** |
| `cmd` | 成員→房主 | UI 指令：裝備 / 卸下 / 賣出 / 賣普通遺物 / 祭壇升級 / 買藥水 / 回城（B）/ 死亡畫面的「回到城鎮」 |
| `tw` | 房主→單一成員 | 「你已在城鎮了」：最終私有狀態＋血量；之後這位玩家的城鎮由他自己的瀏覽器模擬並存檔 |
| `handback` | 成員→房主 | 從城鎮傳送門（選哪扇門或入口）回來：交回最新角色與血量 |

快照內容（`SnapshotPayload`，數值一律 ×100 取整）：`ts`（房主時鐘）、`d`（層數）、`hs`（所有英雄：位置、朝向、血量、護盾、旗標、攻擊動畫、回聲 `echoT`/`echoAge`、救援進度）、`en`（新怪物的靜態資料：種類、最大血量、菁英 / 名稱）、`es`（有變化的怪物：位置、血量、凍結 / 暫停 / 緩速 / 受擊旗標、**頭目動作狀態**與預警圈）、`er`（死亡）、`ps` / `hp` / `pr`（怪物投射物、英雄冰錐：**只在出現時送一次**，接收端直線飛行，房主說結束才移除）、`ls` / `lr`（遺物，只含隊友的，接收端只畫 `ownerId` 是自己的）、`dr`（各英雄留下的傳送門）、`w`（鑰匙 / 閘門 / 用過的符文井 / 被打破的木箱）、`ev`（事件：傷害數字、音效、橫幅、震動、怪物死亡爆裂；同一快照內相同事件合併、上限 28 則；私有事件帶 `toId`）。全員都在城鎮時只送「門 / 樓層」變動。沒有任何變化的快照（靜止時）不送，最多每秒一則 keepalive。

#### 同步方式

- **房主模擬一切**：`heroes[]` = 房主 + 每位隊友（id = 房間 playerId）；多人模式忽略 `?bots`。隊友的英雄在房主引擎裡是 `isRemote` 英雄，用 `in` 訊息當輸入（`controlMode = manual`），攻擊 / 技能 / 傷害 / 掉寶 / 擊殺都由房主算。難度 n = 英雄人數（起始層 = 房主的 `maxDepth`）。
- **隊友是「遠端模式」**：用 `seed` 產生同一張地圖與靜態場景（`generateDungeon` 自帶 RNG；彈簧陷阱的相位在多人模式改由格子座標決定），**不產生怪物**，畫房主快照裡的怪物 / 英雄 / 投射物 / 自己的遺物 / 所有門。自己的攻擊與技能動畫在本機播放，傷害由房主決定（隊友本機沒有怪物，不會誤傷）。
- **插值**：其他英雄與怪物用房主時間戳畫在「現在 − 110 ms」，時鐘偏移取 `min(收到時間 − ts)`。
- **預測與校正**：自己的英雄在本機直接跑原本的移動程式（牆壁碰撞等），同時記錄 2 秒的位置歷史；房主快照回傳 `echoT`（它處理到的最新輸入的時間）與 `echoAge`，隊友在歷史裡找出對應時刻的位置與房主位置比較：誤差 < 0.04 忽略、< 2.5 每個快照修正 30%（歷史一併位移）、≥ 2.5 直接傳送。倒地時一律以房主位置為準。
- **私有狀態**：血量 / 護盾放在快照的英雄資料裡（本機直接顯示）；其他私有資料用 `priv`。隊友的 UI 動作（喝藥、裝備、賣出、升級、買藥、回城、救援按住 F）都是指令 / 輸入，等房主結果回來才改變畫面。
- **城鎮交接（最小版）**：隊友回城 → 房主把該英雄標成 `inTown`（離開模擬、傳送門留在原地）並用 `tw` 交出最終狀態 → 隊友在自己的瀏覽器建城鎮（權威，依 P1 存檔）→ 走傳送門時用 `handback` 交回最新角色，房主把他放在選的門（或該層入口），回 `level`（完整世界）。房主自己進城維持 P4-C 行為（地城在背景繼續模擬、快照照送）。
- **存檔**：每位玩家只存自己的角色（自己的 session，檢查點與 P1 相同：進城、離城、換層、倒地）；`maxDepth` 規則同 P4-C。
- **斷線**：房主離開 / 斷線 → 全員收到 `roomClosed`，先存檔（最多等 4 秒）再回大廳並顯示通知。隊友斷線 → 房主移除該英雄（不掉東西）、其他人看到「XXX 已離開」；**n 從下一層起重新計算，已存在的怪物血量不調整（維持原值）**。

### 5.2 訊息（JSON，日後可換 binary）

| 方向 | type | 內容 |
|---|---|---|
| C→S | （連線時） | `characterId` 放在 WebSocket URL 的 query，由 Pages Function 驗證（P5-A；不再有 `join` 訊息） |
| S→C | `welcome` | `code`、`playerId`、是否為房主、成員清單（P5-A）；P5-B 起另含目前地城完整狀態（若有） |
| S→C | `memberJoined` | 新成員（同一 playerId 再次出現視為更新）（P5-A） |
| C↔S | `chat` | 文字，上限 200 字；伺服器蓋 `from`、`name`、`ts` 後廣播給全員含自己（P5-A） |
| C→S / S→C | `ping` / `pong` | 每 5 秒一次；`ping` 帶 `t` 與自己最近的 `rtt`，`pong` 回 `t` 與全員 `latencies`（P5-A） |
| S→C | `replaced` | 同帳號從別處加入，這條連線被取代（P5-A） |
| C→房主 | `input` | `seq`、移動向量、瞄準方向、按鍵（攻擊 / 衝刺 / 技能 / 藥水 / 互動） |
| 房主→C | `snapshot` | `tick`、heroes[]、enemies[]、projectiles[]、loot[]（含 `ownerId`）、門 |
| 房主→C | `event` | 傷害數字、音效、特效、橫幅（不需重送，掉了就算） |
| C→房主 | `location` | 進城 / 出城（選了哪扇門） |
| C→C（經 S） | `townPos` | 城鎮內位置（5 Hz） |
| S→C | `memberLeft` / `roomClosed` | 有人離開 / 房主離開 → 房間結束（P5-A） |
| C→S / S→C | `startGame` / `gameStarted` | 房主按「開始遊戲」→ 房間鎖定、全員進入遊戲（P5-B） |
| C→S / S→C | `relay` | 房主→全體 / 單人、成員→房主的遊戲訊息（P5-B，見 §5.1.2；下面幾列的 `input` / `snapshot` … 是設計時的名稱，實際 kind 見 §5.1.2） |

- 客戶端依 `ownerId` 過濾 loot，只畫自己的。
- 撿取遺物：房主判定撿到 → 對該玩家發 `event: lootPicked { relic }`，客戶端放進自己的背包。

### 5.2.1 流量預算（Cloudflare 免費方案）

- Durable Objects 每天 **100,000 次請求**；**傳入的 WebSocket 訊息以 20:1 計算**（20 則 = 1 次請求），**送出的訊息與 ping 不計**，連線建立算 1 次。
- 因此設計原則：**傳入 DO 的訊息要少**。成員 → 房主的輸入「有變化才送」（不固定 30 Hz）；房主 → 全體的快照上限 **15 Hz**（房主送快照給 DO 本身是傳入訊息：15 Hz ≈ 54,000 則／小時 ≈ 2,700 次請求／小時）。
- **P5-B 實測（headless Chrome，4 個玩家一起打，約 32 遊戲秒 / 91 實際秒；軟體算圖只有約 8 FPS，所以以「遊戲秒」換算快照）**：
  - 房主送出：快照 **15.0 則／遊戲秒（= 900 則／分）**，平均約 340 字元／則（約 5 KB/s）；`priv` 幾乎只在撿到東西 / 買東西時；另有每 5 秒 1 則 ping。
  - 每位成員送出：`in` 約 **1.9 則／實際秒（≈ 115 則／分）**（測試腳本每 ~1.2 秒換一次方向＋偶爾按住左鍵，真人操作可能更高；按住左鍵邊移動滑鼠時可到上限 20 則／秒），另有 ping 12 則／分。
  - **4 人 × 1 小時的 DO 請求估算**：房主 54,000（快照）+ 720（ping）；3 位成員各約 6,900（輸入）+ 720（ping）。合計約 77,000 則傳入訊息 ÷ 20 ≈ **3,900 次請求／小時**（+ 4 次連線）。保守上限（3 位成員全程 20 Hz）約 271,000 則 ÷ 20 ≈ **13,600 次請求／小時**。免費額度 100,000 次／天 ≈ 約 **7–25 個房間小時／天**。
  - 靜止時（沒人移動、沒有怪物動作）快照不送，實際用量會更低；全員在城鎮時房主只在門 / 樓層變動時送快照。
- P5-A 沒有高頻訊息：每人每 5 秒一則 ping（4 人房間一小時約 144 次請求）＋聊天；保活文字 ping 走 auto-response 不計費。詳見 `docs/p5-setup.md`。

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
| **P5-A 房間基礎設施** | Room Worker＋DO（SQLite、Hibernation）、`POST /api/rooms`、`/api/rooms/:code/ws` 代理與身分驗證、房間大廳（成員、職業、層數、延遲、聊天）、房主離開即結束、多開發帳號；**不同步遊戲畫面** | 4 個帳號能開房、用房號加入、互看成員與聊天；房主離開房間即關閉；單人開始完全不連線 |
| **P5-B 同步遊戲（已完成）** | 房主開始遊戲、快照 / 輸入（`relay`）、插值與預測、各自 loot、各自傳送門、難度縮放接上房間人數、最小版城鎮交接（回城 / 回來）、房主 / 隊友斷線處理 | 4 個瀏覽器分頁能一起打地城（實測見 §5.2.1；**Room Worker 要重新部署**，見 `docs/p5-setup.md`） |
| **P5-C 城鎮與位置同步** | 城鎮內互相看到彼此（`townPos`）、全員回城時地城凍結的連線版（P5-B 只有「隊友在自己的城鎮裡，看不到別人」的最小版） | 多人進出城鎮與地城流程完整 |
| **P6 交易** | 城鎮交易 UI、Room DO 仲裁、D1 batch、`save_version` | 交易後雙方存檔正確，斷線不能刷物品 |
| **P7 中途加入／重連＋打磨** | 進行中加入、斷線重連、延遲補償調整 | 中途加入可直接進地城 |

---

## 10. 待決 / 之後再說

- 難度系統內容（目前只有灰字 UI）。
- 房主是否可以選擇比 `maxDepth` 淺的起始層。
- 房主轉移。
- 公開配對（目前只有房號）。
- 伺服器端完整驗證物品來源（防作弊）。
