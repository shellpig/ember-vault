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
| 起始層數 | 預設 = **房主角色的最高到達層數**；房主 / 單人玩家可在大廳自選 1～`maxDepth` 的較淺起始層 |
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

- **起始層數**：預設 = 房主角色的 `maxDepth`（新角色 = 1）；`maxDepth > 1` 的角色可在大廳（單人）或房間大廳（房主）用滑桿自選 1～`maxDepth`。選擇只存在房主 / 單人客戶端（`restartRun(..., startDepth)`、`MpConfig.startDepth`），**不進協定、不進伺服器**，引擎再 clamp 一次到 [1, `maxDepth`]；起始較淺**不會**降低 `maxDepth`（存檔仍是 `MAX(max_depth, ?)`），到達更深層照舊更新。
- 加入者的 `maxDepth` 比房主低也照樣進入房主的層數；到達更深層時，每個人各自更新自己的 `maxDepth`。
- 大廳顯示「難度」選單，灰字＋「即將推出」，不可操作。
- attract mode（自動模式背景）保留在登入 / 選角畫面後方。

---

## 3. 死亡與傳送門（單人、多人共用）

### 3.1 傳送門

- 每位玩家各有**一個**傳送門位置 `hero.portal: {x, z, depth} | null`（取代現在的單一 `townPortalPos`）。
- 開新門會取代自己的舊門。
- 任何玩家都能走任何人的門（地城 → 城鎮，免費且不覆蓋自己的門）。
- 從城鎮回地城：城鎮傳送門列出所有可用的門（自己的 + 隊友的），選一個出去；**門的主人從城鎮返回地城後，自己的傳送門關閉消失**（隊友走別人的門不會關閉別人的門）。
- 換層時所有人的門都清除。

### 3.2 一般回城

- 維持現有 `returnToTown()` 行為：扣 `getTownReturnCost()`（= `depth * 10`），在腳下開門。

### 3.3 倒地

1. `hp <= 0` → 進入 **倒地（downed）** 狀態：倒地姿勢、不能行動、怪物不再鎖定此玩家。
2. **原地開啟該玩家的傳送門**（取代舊門）。
3. 顯示跟現在一樣的死亡畫面，但按鈕是「**回到城鎮**」。
4. 玩家按下按鈕 → 扣救援費 `getDeathReturnCost()` = `depth * 10 * 5`（主動開傳送門的 5 倍，`DEATH_RETURN_COST_MULT`；死亡畫面按鈕下方小字「救援隊將拯救你，花費 X 金幣」），**金幣不夠就扣到 0** → 傳送回城鎮，HP 回滿。
5. **被救起**：隊友站在倒地者旁（半徑 1.5）按住互動鍵 **3 秒**（受到傷害會中斷進度）
   → 倒地者**滿血**原地復活，死亡畫面**自動關閉**，不扣金幣。原地的傳送門保留。
6. 單人模式：沒有人能救，只能按按鈕回城。**死亡不再結束這一局。**

### 3.4 全員回城

- 地城裡沒有活著的玩家時，房主引擎**凍結地城**（沿用現有 `SavedDungeonSnapshot`；觸發條件從「我回城」改成「最後一個人離開地城」）。
- 有人再從門回到地城時解凍。
- **地上的掉寶保留**：凍結時快照記下每個未撿取的掉寶（擁有者、類型、數值、遺物內容、位置），重建時原地放回（安靜出現、可立即撿）。只存在記憶體，不寫 D1；換層後上一層的掉寶照舊不保留。多人由房主重建，隊友的掉寶經下一次完整快照（`ls`）重新送達。
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
- Boss / 菁英同樣套用血量倍率。Boss 的單人基準血量不再是舊的 `baseHp × bossTierScale`，而是 `202.5 × (1 + (深度 − 1) × 0.22) × 個體係數`（見 [`docs/boss-spec.md`](boss-spec.md) §1），再乘上述人數倍率（`getEnemyHpScale()`，4 人 ×4）。第 10 層 Boss（骸骨大巫妖／熔岩巨像）由地城種子 `genSeed` 決定，房內所有客戶端自然一致；狂暴狀態以敵人快照旗標位元 `EF_ENRAGED`（256，選用）同步，Room DO 只轉送，不需 `deploy:room`。
- **數量的實作方式（P4-B）**：生成完一層的所有怪物後，以「該層非 Boss 怪物總數」計算額外隻數 `floor(總數 × (n−1) / 10)`，再依序輪流分配到各戰鬥房間（每隻是一般怪，隨機落點）。這樣即使每個 pack 都很小，整層也確實會多出幾隻（例：28 隻的樓層，2 人 +2、4 人 +8）；n = 1 時完全不多生，數值與單人相同。
- **生效時機**：生成怪物時依當下的 `n` 計算；有人中途加入或離開時，已存在怪物的血量依比例重算（保留血量百分比），數量則從下一層開始生效。

### 4.1 深度怪物強化、具名菁英光環與敵方爆擊（`feat/difficulty-tuning`）

只作用於一般怪與菁英，**Boss（`isBoss`）完全不受影響**。血量與傷害的深度縮放不變，沒有防禦屬性。實作入口：資料表與常數在 `src/game/engine/data.ts`（`ENEMY_DEPTH_TIERS`、`getEnemyDepthTier`、`ENEMY_AURA_*`、`ENEMY_BASE_CRIT`、`ENEMY_CRIT_MULT`），生成在 `engine/spawn.ts`，光環與攻擊在 `engine/enemies.ts`，減傷在 `heroCombat.ts` 的 `scaleEnemyDamageTaken`。

**深度階梯**（以 `getEffectiveSimDepth()` 查表，與傷害縮放同一深度）：

| 深度 | 普攻攻速 | 移速 | 每個有小怪的房間額外一般怪 |
|---|---|---|---|
| 1–10 | +5% | +5% | +0 |
| 11–15 | +10% | +10% | +1 |
| 16–20 | +15% | +15% | +1 |
| 21–25 | +20% | +20% | +2 |
| 26–30 | +25% | +20% | +2 |
| 31–35 | +30% | +20% | +3 |
| 36+ | +35% | +20% | +3 |

- **攻速**只縮短普攻冷卻（近戰與遠程的 `attackCooldown` 除數，與菁英 1.25 倍、光環相乘；36 層菁英處於攻速光環內約 2.0 倍）。**不縮短 `windupTimer`（預警）**，生成時的初始冷卻隨機值也不變。
- **移速**在 `addEnemy` 乘進 `speed`；群居小怪（`isSwarmEnemy`）已是 3 倍速，不套用。
- **額外怪**：一般戰鬥房、祭壇（`shrine`）房與出口守衛房各多生 N 隻「非菁英、非群居、非守衛」的主題怪（沒有小怪的起點房、Boss 房、寶箱房、鑰匙房不變）。在生成迴圈內加入，所以後續的「每多一名英雄 +10% 數量」會把它們算進總數而自然疊加。

**具名菁英光環**（`isSpecialElite`）：每隻具名菁英在房主／單人生成時隨機帶**恰好一種**光環，同一房間內的兩隻具名菁英光環種類必不相同（`pickNamedEliteAura`）。半徑 `ENEMY_AURA_RADIUS = 5`，範圍內所有**非 Boss** 敵人（含持有者）都受影響；同種不疊加、不同種並存；持有者死亡光環即消失。成員資格每 0.25 秒（`ENEMY_AURA_INTERVAL`）重算並快取在每隻敵人的 `fx*` 旗標，不是每幀 O(n²)。

| 鍵 | 類型 | 效果 | 顏色 / 名牌標籤 |
|---|---|---|---|
| `A` | `atkspd` | 普攻攻速 +20%（冷卻除數 ×1.2） | 橘 `[迅捷]` |
| `B` | `atk` | 造成傷害 +20% | 紅 `[狂暴]` |
| `C` | `dr` | 受到的英雄傷害 −20% | 藍 `[堅韌]` |
| `D` | `move` | 移速 +20%（群居小怪除外） | 綠 `[疾風]` |
| `E` | `crit` | 爆擊率 +20% | 紫 `[致命]` |

- **減傷**：所有英雄對怪物的傷害（普攻、技能、戰寵、冰霜新星、遺物附加傷害）本來就都經過 `scaleEnemyDamageTaken` 這個唯一出口，`dr` 在這裡乘 0.8（最低 1），飄字顯示的是實際扣除值。
- **顯示**（純視覺、房主與隊友同一條路徑）：名牌在名字後面以光環顏色畫 `[標籤]`。具名菁英腳下是一圈柔邊光帶（半徑約 1.4，呼吸式透明度、±5% 縮放脈動）加 5 枚緩慢繞行的菱形符記、內圈柔光與幾顆上飄的光點，並取代原本的橘色菁英地面標記，只留單一光環顏色；一般（未具名）菁英維持原標記。被光環涵蓋的一般怪腳下有一塊柔和光暈（半徑約 0.6，加亮混色、不用硬邊線），多種光環同時涵蓋時同一塊光暈每約 1.2 秒在各光環顏色間緩慢漸變；具名菁英若同時落在別隻的光環內，其內圈柔光會在自己與其他光環顏色間漸變。進出範圍時光暈 0.2 秒淡入淡出，死亡與清層時釋放。貼圖為共用的程序化漸層，每個實例只有自己的材質。

**敵方爆擊**：每隻敵人有 `critChance`（生成時決定，基礎 `ENEMY_BASE_CRIT = 0`，日後單一種類的爆擊只需改生成時的數值），爆擊倍率 `ENEMY_CRIT_MULT = 1.5`；`crit` 光環加 +0.2。近戰在命中時擲骰；遠程在**發射時**擲骰並記在投射物上，命中時套用。爆擊時英雄頭上飄字為「爆擊 -X」（`playerHit` 色調）。Boss 不套光環也不爆擊。

**多人**：怪物模擬仍由房主權威。`EnemyStatic`（`shared/game.ts`）新增選用欄位 `a`（光環鍵 `A`～`E`），房主於 `mp/host.ts` 填入，隊友在 `mp/guest.ts` 只用來畫名牌標籤與地面圈，不計算光環效果。爆擊飄字走既有的飄字事件，隊友不需要新欄位。只動 `shared/game.ts`，未改 `shared/room.ts` 與 `workers/room/**`，**不需要 `deploy:room`**。

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
  - 錯誤碼：未登入 401；角色不屬於本帳號或不存在 403；房號格式錯誤或房間不存在 404；滿 4 人 409（P7 起不再有「遊戲已開始」409）；同一帳號重複加入 → **取代舊連線**（沿用原 playerId，舊連線收到 `replaced`）。
- **Hibernation**：`ctx.acceptWebSocket`、`webSocketMessage/Close/Error`、成員資訊用 `serializeAttachment` 存在每條連線上；房間 meta（房主 accountId、建立時間）存在 DO storage。保活用 `setWebSocketAutoResponse`（文字 `ping` → `pong`，不喚醒 DO、不計請求）。
- **房間生命週期**：非房主只能加入「房主已連線」的房間；房主離開、或**大廳階段**房主斷線 → 廣播 `roomClosed`、關閉全部連線、`deleteAll()` 清掉狀態（房號可再使用）。**P7：遊戲進行中**房主的連線意外斷掉不再立刻關房，而是進入 15 秒寬限期（見 §5.1.4）；同一個房主頁面在期限內回來可保留房主權威，否則才 `roomClosed`。已開始的房間也接受加入（上限仍是 4 人，見 §5.1.4）。建立後 2 分鐘房主沒連上（或連線全消失）→ alarm 清除。
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
| `cmd` | 成員→房主 | UI 指令：裝備 / 卸下 / 賣出 / 賣普通遺物 / 丟棄（`disc`）/ 一鍵丟棄藍色（`discb`）/ 祭壇升級 / 買藥水 / 回城（B）/ 死亡畫面的「回到城鎮」 |
| `tw` | 房主→單一成員 | 「你已在城鎮了」：最終私有狀態＋血量；之後這位玩家的城鎮由他自己的瀏覽器模擬並存檔 |
| `handback` | 成員→房主 | 從城鎮傳送門（選哪扇門或入口）回來：交回最新角色與血量 |

快照內容（`SnapshotPayload`，數值一律 ×100 取整）：`ts`（房主時鐘）、`d`（層數）、`hs`（所有英雄：位置、朝向、血量、護盾、旗標、攻擊動畫、回聲 `echoT`/`echoAge`、救援進度）、`en`（新怪物的靜態資料：種類、最大血量、菁英 / 名稱、具名菁英光環鍵 `a`，見 §4.1）、`es`（有變化的怪物：位置、血量、凍結 / 暫停 / 緩速 / 受擊旗標、**頭目動作狀態**與預警圈）、`er`（死亡）、`ps` / `hp` / `pr`（怪物投射物、英雄冰錐：**只在出現時送一次**，接收端直線飛行，房主說結束才移除）、`ls` / `lr`（遺物，只含隊友的，接收端只畫 `ownerId` 是自己的）、`dr`（各英雄留下的傳送門）、`w`（鑰匙 / 閘門 / 用過的符文井 / 被打破的木箱）、`ev`（事件：傷害數字、音效、橫幅、震動、怪物死亡爆裂；同一快照內相同事件合併、上限 28 則；私有事件帶 `toId`）。全員都在城鎮時只送「門 / 樓層」變動。沒有任何變化的快照（靜止時）不送，最多每秒一則 keepalive。

#### 同步方式

- **房主模擬一切**：`heroes[]` = 房主 + 每位隊友（id = 房間 playerId）；多人模式忽略 `?bots` 與單人 bot 設定。隊友的英雄在房主引擎裡是 `isRemote` 英雄，用 `in` 訊息當輸入（`controlMode = manual`），攻擊 / 技能 / 傷害 / 掉寶 / 擊殺都由房主算。難度 n = 英雄人數（起始層 = 房主在房間大廳選的層數，預設與上限為房主的 `maxDepth`）。
- **隊友是「遠端模式」**：用 `seed` 產生同一張地圖與靜態場景（`generateDungeon` 自帶 RNG；彈簧陷阱的相位在多人模式改由格子座標決定），**不產生怪物**，畫房主快照裡的怪物 / 英雄 / 投射物 / 自己的遺物 / 所有門。自己的攻擊與技能動畫在本機播放，傷害由房主決定（隊友本機沒有怪物，不會誤傷）。
- **插值**：其他英雄與怪物用房主時間戳畫在「現在 − 110 ms」，時鐘偏移取 `min(收到時間 − ts)`。
- **預測與校正**：自己的英雄在本機直接跑原本的移動程式（牆壁碰撞等），同時記錄 2 秒的位置歷史；房主快照回傳 `echoT`（它處理到的最新輸入的時間）與 `echoAge`，隊友在歷史裡找出對應時刻的位置與房主位置比較：誤差 < 0.04 忽略、< 2.5 每個快照修正 30%（歷史一併位移）、≥ 2.5 直接傳送。倒地時一律以房主位置為準。
- **私有狀態**：血量 / 護盾放在快照的英雄資料裡（本機直接顯示）；其他私有資料用 `priv`。隊友的 UI 動作（喝藥、裝備、賣出、升級、買藥、回城、救援按住 F）都是指令 / 輸入，等房主結果回來才改變畫面。
- **城鎮交接（最小版）**：隊友回城 → 房主把該英雄標成 `inTown`（離開模擬、傳送門留在原地）並用 `tw` 交出最終狀態 → 隊友在自己的瀏覽器建城鎮（權威，依 P1 存檔）→ 走傳送門時用 `handback` 交回最新角色，房主把他放在選的門（或該層入口），回 `level`（完整世界）。房主自己進城維持 P4-C 行為（地城在背景繼續模擬、快照照送）。
- **存檔**：每位玩家只存自己的角色（自己的 session，檢查點與 P1 相同：進城、離城、換層、倒地）；`maxDepth` 規則同 P4-C。
- **斷線**：房主離開 / 斷線 → 全員收到 `roomClosed`，先存檔（最多等 4 秒）再回大廳並顯示通知。隊友斷線 → 房主移除該英雄（不掉東西）、其他人看到「XXX 已離開」；**n 從下一層起重新計算，已存在的怪物血量不調整（維持原值）**。

### 5.1.3 P5-C 實際協定（已實作）：城鎮同步與多人進出流程

**Room DO 新增一種訊息（要重新部署 Room Worker）**：

- `townPos`（C→S）`{ type:'townPos', x, z, f, a }`：任何成員（含房主）送自己的**城鎮位置**。`x`、`z`、`f` 是 ×100 取整，`a`：0 站著、1 走路、2「剛出現在這裡」（進城 / 回到城鎮時，接收端清掉插值緩衝，不會從舊位置滑過來）。DO 只在遊戲已開始後接受、驗證為有限數字並夾限範圍，然後以 `{ type:'townPos', from, x, z, f, a }`（`from` 由伺服器蓋章）**直接廣播給其他所有成員**，不經房主。
  - 路由選擇與理由：若走 `relay`，成員的訊息只能到房主、再由房主轉發給其他人，每個位置會在 DO 的傳入計費裡算**兩次**（成員→DO、房主→DO），還多一跳延遲，且房主卡頓時城鎮就會卡。直接廣播只算一次傳入，送出不計費。
  - 沒有重新部署 Worker 的話（舊 DO 會忽略未知訊息）遊戲照常進行，只是看不到彼此在城鎮裡的模型。
- 發送端（`engine.mpTownSend`）：在城鎮、沒有淡入淡出、沒有倒地時才送；進城後第一則 `a=2`；之後最高 5 Hz，**位置有變化（> 0.02）才送**，停下來時再補一則 `a=0`；站著不動不送任何東西。
- 接收端（`engine.mpOnTownPos` / `mpTownRemotes`）：不論自己在不在城鎮都記錄每位隊友最後的位置（以本機收到的時間蓋時戳）；只有「自己在城鎮、對方也在城鎮（房主的 `st` 說了算）」才畫對方的英雄模型：職業外觀、頭上名牌、畫在「現在 − 260 ms」的插值位置（5 Hz 的間隔是 200 ms）、走路動畫由位移推算。對方離開城鎮（`st` 不再是「城鎮」）就不畫。

**房主 → 全員的隊伍狀態 `st`（relay kind，只在變動時送）**：`{ d, h:[[heroId, 0 地城|1 城鎮|2 倒地]…], dr:[門…] }`。快照在地城凍結或沒人在地城時不送，但城鎮的門清單與成員面板要即時，所以房主每個 frame 比對一次簽章，有變才送（隊友開門、換層清門、有人進出城鎮或倒地）。隊友在城鎮時以 `st` 為準（更新 `h.inTown`、門、樓層）；在地城時仍以快照為準。

**全員回城與解凍（房主權威）**：
- 地城中沒有活著的英雄（房主在城鎮、隊友都在城鎮或倒地；或房主自己回城且隊友都倒地）→ 房主凍結地城（`SavedDungeonSnapshot`）並停止快照。凍結前送**一次最後的快照＋私有狀態**（`mpHostFreezeFlush`），否則最後一位倒地的隊友可能收不到自己的倒地狀態（P5-B 的小漏洞）。
- 地城凍結時**任何人**從門回來都不必等房主：隊友的 `handback` 由房主在城鎮裡處理（`mpHostFrozenTick`）→ `mpHostRebuildAway`：房主在**背景**重建這一層（怪物依 §3.4 重生、門／符文井／木箱／鑰匙／地上掉寶保留、門周圍安全），重建出的地城成為房主的「停放中的地城」（`dungeonCtx`）並持續模擬、照送快照；房主之後從自己選的門（或任何門）回來時走「地城仍在進行」的路徑，出現在選的門。
- 隊友等待畫面：黑屏中央顯示「正在進入第 N 層…」（`hud.mpWait`）；城鎮場景保留到房主的 `level` 抵達才釋放。**10 秒**沒有答覆 → 回到城鎮、提示「房主沒有回應，無法進入地城，已留在城鎮」，並送 `hbc`（房主若已處理就把他放回城鎮，仍在佇列就丟掉）；房主無法處理時回 `hbx`，同樣留在城鎮。逾時後才抵達的舊 `level` 會被忽略。
- 修正：`leaveTownScene` 原本會把**所有**英雄標成「不在城鎮」，房主離開自己的城鎮或換層時，在自己城鎮裡的隊友會被當成回到地城（房主模擬幽靈、還送 `level` 把隊友拉出城鎮）。現在只重設非遠端英雄。
- 已知限制：房主倒地、坐在死亡畫面上而隊友都在城鎮時，地城不算「清空」（房主還沒按回城）；此時隊友回來不會讓怪物重生。

**隊友的木箱本機預測**：隊友自己的攻擊／冰錐／新星打到木箱或甕時，本機立刻播碎裂特效、隱藏並標記為已破（純視覺，不掉東西）；房主快照的 `w.br` 確認就保留，**1.5 秒內沒被確認**就恢復顯示（房主判定沒打破）。

**遊戲中聊天與成員面板**：沿用 P5-A 的 `chat`（伺服器蓋章 from／name）。Enter 開啟輸入框（輸入時英雄停止移動，`setInputLocked`）、Enter 送出、Esc 取消；訊息顯示 7 秒後淡出。右上角「隊伍」小面板列出所有人與狀態（地城／城鎮／倒地），城鎮與地城都看得到。

### 5.1.4 P7 實際協定（已實作，待驗收）：中途加入、重連與打磨

**中途加入。** DO 不再因 `meta.started` 拒絕加入（移除 409 `game_started`）；已開始的房間只要「房主在線且人數 < 4」就收人，`welcome.started = true`。大廳畫面收到 `started` 的 `welcome`（非房主）就略過房間大廳，直接把連線交給遊戲（`RoomGameStart.late`）。加入者的引擎照一般隊友起手（`mpStart`，`late` 只改等待文字），送出一次 `loadout`（無倉庫）：

- 房主引擎（遊戲已 `launched`）把 `loadout` 排進 `host.joiners`，在下一次模擬步驟（`mpHostPost`／凍結時 `mpHostFrozenTick`，背景地城也算）由 `mpHostAddJoiner` 建立英雄（`inTown = true`）。同一玩家 id 已有英雄（舊連線尚未被房間發現就重連）→ 先移除舊英雄再建新的。
- **預設出生在城鎮**：房主回一則 `tw`（`TownPayload`，新增選用欄位 `st` = 當下的隊伍狀態：層數、門、誰在哪裡），加入者據此建城鎮、套用深度與門清單，並用成員清單補建隊友模型；之後走既有的城鎮傳送門選擇器（沒有門時選項本來就是「第 N 層入口」）。
- **沒有門可走**（目前這層沒有任何傳送門、沒有任何英雄在城鎮、房主在地城）→ 房主直接以合成的 `handback`（`door: 'entrance'`）走既有的 `mpHostOnHandback`：英雄放到本層 room 0，並送該加入者 `level`（含其 `priv`），與城鎮門走出來完全相同。
- 難度縮放沿用規則：人數 `n` 在下一次建層時重算（`heroes.length`）；已生成的怪物血量不變。房主之後廣播 `st`（強制一次）。快照裡的隊友若沒有名冊，職業取自房間成員清單（修正中途加入者模型一律是戰士的問題）。
- 新增訊息量：每個加入者一次性的 `loadout`、`tw`／`level`、一則 `st`。沒有新的週期性訊息。

**成員自動重連。** 客戶端在非主動離開、非 `roomClosed`／`replaced`／1008／1009 的 close 後呼叫 `RoomClient.reconnect()`：退避 1、2、4、8、8… 秒（各加 0–250 ms 抖動），總窗口 30 秒（`MEMBER_RECONNECT_WINDOW_MS`），`unauthorized`／`forbidden`／`invalid_code` 立即放棄。期間顯示「重新連線中…」（遊戲凍結地城視角，`mpSetPaused`）、開啟中的交易在本機解鎖（DO 因斷線已取消）。重連成功後先 `flush`（最多 4 秒）再 `GET /api/characters/:id` 取得最新存檔（`base_version` 因此是當前版本；409 仍會暫停存檔），用它建新的 `SaveManager`，再當作中途加入者重新 `mpStart`。上次存檔後撿的東西會遺失（§8.3 已接受）。失敗 → 既有的 `endRoomGame`（存檔、回大廳並顯示提示）。房主端把成員斷線照舊視為離開（移除英雄、「XXX 已離開」），重連顯示為一次新的加入。

**房主 15 秒寬限與接管。** 每個 `RoomClient`（頁面、每場遊戲）產生隨機 `resumeToken`（32 hex），每次加入帶在查詢參數 `resume`；Pages 驗格式後放進內部 header `x-ev-resume`（和 `x-ev-identity` 一樣先清掉瀏覽器送的 `x-ev-*`）。DO 只在房主帳號加入時把它記進 `meta.hostToken`。**它是額外檢查，不是身分**：身分永遠只來自 `x-ev-identity`。

- 遊戲進行中房主 socket 斷掉、且 `meta.hostToken` 存在 → 不關房：`meta.hostGoneUntil = now + 15 s`（`HOST_GRACE_MS`）寫進 storage、`setAlarm(hostGoneUntil)`、廣播新的 `hostState { state: 'reconnecting', graceMs }`。成員凍結地城視角（城鎮照常）。寬限期內其他人加入回 404（房主不在）。大廳階段或沒有 token（舊客戶端）→ 照舊立刻關房。
- 房主帳號在寬限期內以**相同 token** 加入 → 清除 `hostGoneUntil` 與 alarm，`welcome.resumed = true`（成員清單為當下的）、廣播 `hostState: ok`；不廣播 `memberJoined`。房主客戶端呼叫 `mpHostResume(members)`：移除寬限期間離開的隊友英雄，然後在下一個模擬步驟對地城裡的每個隊友重送 `level`（完整快照）、強制 `st` 與私有狀態（背景地城、凍結樓層也各有對應路徑）。房主在斷線期間整個引擎凍結（`mpSetPaused`），所以隊友不會在沒有回應的狀態下被怪物打。
- token 不符／沒有 token（重新整理頁面）／超時（alarm 觸發 `host_left`）→ `closeRoom('host_left')`，成員存檔並回大廳。房主退避窗口為 14 秒（`HOST_RECONNECT_WINDOW_MS`）。房主遷移仍在範圍外（§10）。
- Hibernation：寬限狀態在 DO storage 的 `meta`（`hostToken`、`hostGoneUntil`），alarm 喚醒後從 storage 還原，不依賴記憶體。

**自適應插值延遲。** 不新增任何訊息。接收端在 `s` 到達時以 RFC 3550 方式量測快照傳輸時間變化（`|Δ(收到時間 − 房主 ts)|`，上限 400 ms，EWMA 1/16），地城插值延遲 = `clamp(110 + 2.5 × jitter, 110, 220)` ms（再以 0.1 平滑逼近）。城鎮每位隊友以 5 Hz 移動串流的到達間隔偏離 200 ms 的量為 jitter，延遲 = `clamp(260 + 2.5 × jitter, 260, 420)` ms。位置緩衝加大（英雄／怪物 8 筆）以容納 220 ms。既有的本機預測與 `echoT` 校正不變。常數在 `shared/game.ts`（`INTERP_DELAY_MAX_MS`、`INTERP_JITTER_K`、`TOWN_INTERP_DELAY_MAX_MS`）。

**建房限流。** `POST /api/rooms` 每帳號 10 分鐘內最多 5 次（`ROOM_CREATE_LIMIT`），超過回 **429** `{ error: 'room_create_limited' }`，大廳顯示「建立房間太頻繁…」。以 D1 表 `room_creates (id, account_id, created_at)` + `(account_id, created_at)` 索引實作（migration `0002_room_creates.sql`）；只計成功建立的房間，每次寫入時順便刪除窗口外的舊列。D1 查詢失敗時記錄 log 並放行（不因限流表故障擋住開房）。

**限制。** 中途加入者出生在城鎮或入口，所以重連後上次存檔以來的戰利品會遺失；房主重新整理頁面無法接管（關房）；寬限期間成員被凍結，不能在地城行動。

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
| C→S→全員 | `townPos` | 城鎮內位置：5 Hz、有移動才送；**由 Room DO 直接扇出給其他成員，不經房主**（P5-C，見 §5.1.3） |
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
- **P5-C 城鎮位置（headless Chrome，3 個玩家同在城鎮，每人連續走動 20 秒，約 9 遊戲秒）**：每位走動中的玩家送出 `townPos` **約 5.0 則／遊戲秒**（45 則／9 遊戲秒；站著不動 10 秒只有停下時的那 1 則；軟體算圖只有約 3 FPS，所以以遊戲秒換算），每則約 73 字元；其他每人只收到對方的廣播（送出不計費）。`st` 隊伍狀態只在變動時送（幾秒一次或更少）。
  - **4 人全程在城鎮一直走動的最壞情況**：4 × 5 Hz = 20 則／秒 ≈ 72,000 則／小時 ÷ 20 ≈ **3,600 次請求／小時**（比 P5-B 的整個地城房間還高，但全員同時一直走動是不現實的上限；站著 / 在地城的人不送）。典型情況（一半時間在走）約 1,000–2,000 次／小時。免費額度 100,000 次／天仍可支撐約 25 個以上的城鎮房間小時。
  - 全員在城鎮時房主不送快照（0 則，已實測）、地城凍結後也是 0；房主在城鎮而隊友在地城時房主仍背景模擬，快照 15 Hz（P5-B 的數字）。
- P5-A 沒有高頻訊息：每人每 5 秒一則 ping（4 人房間一小時約 144 次請求）＋聊天；保活文字 ping 走 auto-response 不計費。詳見 `docs/p5-setup.md`。

### 5.3 中途加入

- 新玩家一律出生在**城鎮**，從城鎮傳送門選隊友的門進入。
- 如果沒有任何門可走（全員都在地城、沒人開門），改為出生在**該層入口（room 0）**。
- 斷線重連 = 同一個角色再 `join` 一次，走同一套流程。
- P7 已實作，實際協定見 §5.1.4。

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
- 網址參數 `?bots=N`（0–3）為開發用覆寫：強制加入 N 個本機 bot（職業取自 UI 設定、不足者隨機）；bot 永遠不存檔、不打 API。
- **單人 bot 選項**：單人大廳可選 0～3 個 bot 並各自指定職業（`SELECTABLE_CLASS_IDS`），設定存 `localStorage`（`embervault.botSetup.v1`）。bot 強度規則：
  - 等級 = 玩家的升級總數（`getTotalUpgradeLevel()`），以 `distributeUpgradePoints()`（`classes.ts`）依該職業祭壇選項輪流平均分配，選項滿上限就把餘額給其他選項。
  - 遺物：複製玩家裝備中的遺物，所有**數值加成**（含套裝件數加成）乘 `BOT_RELIC_SCALE = 0.8`（`Hero.relicScale` → `scaleRelicSummary()`）；`maxHp`、`damageReduction`、`lifeOnKill`、`thorns` 四個固定值四捨五入為整數。**無法縮放的質性效果**（傳說遺物特效 `uniqueEffects`、四件套光環）照常生效。
  - 同步：引擎每 0.5 秒比對玩家的升級總數與裝備遺物 id，變動（祭壇購買、換裝、進出城鎮）即重算所有 bot，最大血量增加的部分當作治療。
  - bot 永遠不存檔、不打 API、不開房；怪物依人數縮放照舊把 bot 算進 n。
  - 名字：每局從 `BOT_NAMES`（`classes.ts`，含部分搞笑名）隨機抽不重複的名字，顯示在頭頂名牌、傳送門與 HUD。
  - 喝藥水：單人模式本地玩家喝藥水時，地城中存活且未滿血的 bot 也各回復同樣的量（任一 bot 受傷時即使玩家滿血也能喝）。
  - HUD 隊友列：左上角玩家狀態板（與戰寵卡）下方，每位 bot（單人）或其他玩家（多人）一列精簡列：職業色點、LV、名字、血條（法師多一條細護盾條）、倒地／城鎮標記，寬度約為狀態板一半。多人時等級與最大護盾由房主快照 `HeroSnap` 尾端兩個選用欄位（`level`、`maxShield`）帶給隊友，舊客戶端忽略即可，Room DO 只轉送不解析，不需 `deploy:room`。
  - 歸隊：bot 與玩家距離 > 7.5（`BOT_REGROUP_DIST`）就放棄目標、優先走回玩家身邊，回到 5 以內（`BOT_REGROUP_DONE_DIST`）才重新參戰；快到螢幕邊緣（NDC 0.9，`COMPANION_EDGE_NDC`）時直接瞬移回玩家旁。

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

### 7.1 P6 實際協定（已實作，待驗收）

**Room Worker 現在綁 D1**：`workers/room/wrangler.toml` 多了 `[[d1_databases]]` binding `DB`（與根目錄 `wrangler.toml` 同一個資料庫）。DO 只有在交易時碰 D1（讀兩個角色、寫兩個角色＋一筆 `trades`）；沒有新的 migration（`trades` 表 P1 就建好了）。`VerifiedIdentity` 新增 `characterId`（`functions/api/rooms/[code]/ws.ts` 在驗證角色歸屬後填入，DO 的 `parseIdentity` 要求必填），DO 從 socket attachment 取得「這條連線是哪個角色」，不接受瀏覽器自報。

**訊息（皆由 DO 處理，不走 `relay`；型別在 `shared/room.ts`，計算在 `shared/trade.ts`）**：

| 方向 | 訊息 | 說明 |
|---|---|---|
| C→S | `townState { inTown }` | 客戶端回報英雄是否在城鎮（只在變動時送）。城鎮本機模擬，所以位置由客戶端回報；對交易的信任等級與 `townPos` 相同（朋友間可接受）。離開城鎮 = 結束該玩家的交易 |
| C→S | `tradeReq { to }` | A 對 B 發起。雙方都要「已開始遊戲、在城鎮、沒有其他交易／請求」，否則 `tradeEnd(unavailable)` |
| S→C | `tradeWait` ／ `tradeRequest` | 給 A（等待中）／給 B（來邀請，帶 `tradeId`） |
| C→S | `tradeAccept { tradeId }` | 只有 B 能接受；DO 再檢查一次雙方仍在城鎮、請求未逾時（30 秒＋5 秒寬限）→ `tradeOpen` 給雙方，緊接著 `tradeUpdate`（rev 0） |
| C→S | `tradeOffer { tradeId, gold, relics:[{id, from:'bag'\|'stash'}] }` | **整份**取代自己的提供。DO **從 D1 重讀這個角色**，驗證遺物在宣告的來源、金幣足夠，並把**D1 裡的遺物內容**放進給對方看的 `tradeUpdate`（對方看到的永遠是真實存檔資料，不是客戶端自報的）。成功後 `rev++`、雙方確認都重置。失敗只回 `tradeError`（原提供不變） |
| S→C | `tradeUpdate { tradeId, rev, mine, theirs }` | 每次變動雙方各收一份（`mine`／`theirs` 各含金幣、遺物＋內容、`confirmed`） |
| C→S | `tradeConfirm { tradeId, rev }` | 只對**看到的那一版**有效：`rev` 不符（對方剛改過）、還有 offer 在讀 D1、雙方都空 → 忽略或 `tradeError(empty_trade)`。雙方都確認就執行 |
| C→S | `tradeCancel { tradeId? }` | 取消／拒絕。DO 對取消者回 `tradeEnd(self)`、對方回 `tradeEnd(cancelled)`；不認識的交易回 `tradeEnd(expired)`；**執行中不能取消**（結果以 `tradeDone`／`tradeEnd(failed)` 為準） |
| S→C | `tradeEnd { tradeId, reason, code? }` | 沒有搬任何東西就結束：`cancelled`、`self`、`timeout`、`partner_left`（斷線或被同帳號頂替）、`left_town`、`unavailable`、`expired`（DO 不認得這筆交易，例如被回收）、`failed`（執行失敗，`code` 見下） |
| S→C | `tradeDone { tradeId, saveVersion, gold, gave, received }` | 已寫入 D1。**倉庫不經 WebSocket**（AGENTS 規則 4）：客戶端收到後用 `GET /api/characters/:id` 取新存檔，再以伺服器版本取代本機的金幣／背包／倉庫與 `save_version` |

錯誤碼（`TradeErrorCode`）：`invalid_offer`、`item_missing`、`gold_insufficient`、`no_space`、`empty_trade`、`offer_changed`、`version_conflict`、`server_error`。

**DO 端狀態**：每房間一個 `Map<tradeId, Trade>`，一人同時只能有一筆交易（含尚未回應的請求）。**只放記憶體、不寫 storage**：DO 被回收就等於交易取消，客戶端下一則交易訊息會收到 `tradeEnd(expired)` 並解鎖（實務上每 5 秒的 ping 會讓房間 DO 保持清醒）。執行中有 `executing` 旗標，期間 offer／confirm／cancel／斷線都不會打斷。對方斷線、被頂替、離開城鎮或房間關閉 → 交易結束。

**執行（`workers/room/src/trade.ts` `executeTrade`）**：
1. 讀兩個角色（`SELECT`，並確認 `account_id` 與連線身分相符）。
2. 純函式 `applyTrade`（`shared/trade.ts`）：遺物必須在宣告來源（裝備中的遺物不可交易）、金幣足夠、收件者空間足夠（先放背包 30，溢出放倉庫 200，兩者都滿才 `no_space`；兩邊先各自移出再算空間，所以背包全滿也能 1 換 1）、每邊最多 `MAX_TRADE_RELICS = 20` 件。
3. 比對「雙方確認時看到的遺物」與 D1 現值（JSON 全等），不同 → `offer_changed`（防止同 id 被改內容）。
4. **一個 D1 batch**（交易式、任一語句丟錯就整批回滾）：`UPDATE A … WHERE save_version = 讀到的` → 守門 `SELECT CASE WHEN changes() = 1 THEN 1 ELSE abs(-9223372036854775808) END`（沒更新到列就丟 `integer overflow` 錯誤）→ `UPDATE B …` → 守門 → `INSERT INTO trades`（payload 含雙方交出的遺物完整內容與金幣）。版本不符（中間有人 PUT 過存檔）→ 整批回滾、回 `version_conflict`，**不會只寫一半**。
5. 成功：兩邊 `save_version` +1，各收 `tradeDone`；失敗：兩邊收 `tradeEnd(failed, code)`，沒有任何寫入。

**客戶端（`App.tsx`、`saveManager.ts`、`engine.ts`、`TradeModal.tsx`）**：
- 城鎮中隊伍面板（右上角）對「也在城鎮」的隊友顯示「交易」；收到邀請時上方出現接受／拒絕（30 秒無回應自動取消）。
- **開始前上鎖**：發起方送請求前、接受方接受前，先 `engine.setTradeLock(true)`（拒絕裝備／賣出／購買／升級／倉庫操作／進傳送門，並關閉倉庫視窗）再 `SaveManager.beginTrade()`（把目前狀態 PUT 一次，D1 成為權威版本，之後到 `endTrade` 為止不上傳、也不送 `sendBeacon`）。flush 失敗就不開始。
- 交易視窗（`TradeModal`）：左我方提供（金幣輸入＋遺物，可由背包／倉庫挑選）、右對方提供、雙方確認狀態、取消；Esc 或離開城鎮也會取消。
- 結果：`tradeDone` → 取新存檔 → `engine.applyTradeSave`（金幣、背包、倉庫）＋ `SaveManager.endTrade(新版本)` → 解鎖；取不到存檔則走「離開房間、從雲端重載」流程（D1 才是真的）。
- 單人遊玩完全不連線、沒有交易 UI。

**防刷物品**：交易寫入後 D1 的 `save_version` 已 +1。客戶端若在收到結果前斷線，舊狀態只能以舊 `base_version` 上傳，會 409。持有交易鎖的客戶端也不會上傳或送 beacon。

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
| **P5-C 城鎮與位置同步（已完成）** | 城鎮內互相看到彼此（`townPos`，由 DO 直接廣播）、全員回城時地城凍結的連線版（任何人都可先回地城、房主背景重建）、等待畫面與 10 秒逾時、成員面板、遊戲中聊天、隊友木箱本機預測 | 多人進出城鎮與地城流程完整（實測見 §5.1.3、§5.2.1；**Room Worker 要重新部署**，見 `docs/p5-setup.md`） |
| **P6 交易（已實作，待驗收）** | 城鎮交易 UI、Room DO 仲裁（Room Worker 綁 D1）、D1 batch 原子寫入、`save_version`（見 §7.1） | 交易後雙方存檔正確，斷線不能刷物品（**Room Worker 要重新部署**，見 `docs/p5-setup.md`） |
| **P7 中途加入／重連＋打磨（已實作，待驗收）** | 進行中加入、成員自動重連、房主 15 秒寬限與接管、自適應插值延遲、建房限流（見 §5.1.4；**Pages 與 Room Worker 都要部署，並先跑 D1 migration `0002`**，見 `docs/p5-setup.md`） | 中途加入可直接進地城 |

---

## 10. 待決 / 之後再說

- 難度系統內容（目前只有灰字 UI）。
- ~~房主是否可以選擇比 `maxDepth` 淺的起始層。~~ 已解決：可自選 1～`maxDepth`（§5.1 起始層數）。
- 房主轉移。
- 公開配對（目前只有房號）。
- 伺服器端完整驗證物品來源（防作弊）。
