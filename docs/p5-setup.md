# P5 房間 — 設定與開發指南（P5-A 房間基礎設施＋P5-B 同步遊戲＋P5-C 城鎮同步）

P5-A：開房、用 6 碼房號加入、在房間大廳看到彼此（角色名、職業、最高層數、延遲）、聊天、房主離開房間就結束。
P5-B：房主按「開始遊戲」→ 大家一起進地城（房主模擬、隊友遠端模式＋移動預測）。規格見 `docs/multiplayer-spec.md` §5。
P5-C：城鎮裡互相看得到（位置由 Room DO 直接廣播）、全員回城後任何人都能先回地城、等待畫面與逾時、成員面板、遊戲中聊天。

> **P5-C 在 Room DO 新增了 `townPos` 訊息（`workers/room/src/index.ts`、`shared/room.ts`），要重新部署 Room Worker（`npm run deploy:room`），建議在合併 / 部署 Pages 之前或同時完成。** 沒部署的話遊戲照常，但城鎮裡看不到彼此的模型（舊 DO 會忽略 `townPos`）。其餘 P5-C 功能（全員回城解凍、等待畫面、聊天、成員面板）只在前端，不需要新的 migration。

> **P5-B 改了 `workers/room/` 與 `shared/room.ts`，上線前一定要重新部署 Room Worker（`npm run deploy:room`），而且要在合併 / 部署 Pages 之前或同時完成。** 舊版 Worker 不認得 `startGame`、`relay` 會被忽略，房間會卡在大廳。

## 架構速覽

```
瀏覽器 ──HTTPS / WSS──▶ Cloudflare Pages（Pages Functions：驗證 session、角色）
                           │  binding ROOM（只有 Pages 能呼叫）
                           ▼
                  Worker「ember-vault-room」── Durable Object `Room`（一房一個，SQLite 版）
```

- Pages Functions 不能定義 Durable Object class，所以 `Room` 放在獨立的 Worker：`workers/room/`（自己的 `wrangler.toml`）。
- 這個 Worker **沒有對外路由**（`workers_dev = false`，沒有 routes）。瀏覽器只會連 Pages；Pages 驗證完身分後，用內部 header 把身分交給 DO，DO 不信任瀏覽器送來的任何身分欄位。
- 單人模式完全不碰這一套：不建房、不連 WebSocket。

| 檔案 | 用途 |
|---|---|
| `workers/room/src/index.ts` | `Room` Durable Object（WebSocket Hibernation API） |
| `workers/room/wrangler.toml` | Room Worker 設定（SQLite migration `v1`） |
| `shared/room.ts` | 訊息協定與各項上限（DO、Functions、瀏覽器共用） |
| `functions/api/rooms/index.ts` | `POST /api/rooms`（開房） |
| `functions/api/rooms/[code]/ws.ts` | `GET /api/rooms/:code/ws`（WebSocket 入口） |
| `src/net/roomClient.ts` | 瀏覽器 WebSocket 客戶端 |
| `src/components/RoomScreens.tsx` | 房間大廳畫面（P5-B 起有「開始遊戲」） |
| `shared/game.ts` | P5-B 遊戲訊息格式（快照、輸入、指令、城鎮交接）與流量常數 |

## 第一次部署（你要手動做的事）

**順序很重要**：Pages 的 `ROOM` binding 指向 Worker `ember-vault-room`，這個 Worker 必須**先**存在，Pages 才能部署成功。

1. 在你自己的電腦（不是這個雲端環境）：
   ```bash
   npm install
   npx wrangler login                 # 第一次使用才需要
   cd workers/room
   npx wrangler deploy                # 部署 Room Worker 與 Durable Object（建立 SQLite migration v1）
   ```
   （在專案根目錄也可以用 `npm run deploy:room`，效果相同。）
   看到 `Deployed ember-vault-room` 即成功。「沒有 routes / workers.dev 已停用」的提示是預期的（我們就是不要它公開）。
2. **再**合併 P5-A 的 PR，讓 Cloudflare Pages 重新部署。Pages 會讀根目錄 `wrangler.toml` 裡的 `[[durable_objects.bindings]]`（`ROOM`，`script_name = "ember-vault-room"`），不需要在 dashboard 手動設定 binding。
3. 驗證：登入後在大廳按「建立房間」，應該拿到 6 碼房號；用另一個瀏覽器／帳號輸入房號加入。

> 如果先合併 PR、還沒部署 Worker：Pages 部署會失敗並提示找不到 Worker `ember-vault-room`。照上面步驟補部署 Worker 後，重新觸發 Pages 部署即可。

### P5-B 升級（已部署過 P5-A 的人）

1. 先 `npm run deploy:room`（不需要新的 migration，Room DO 的 storage 只多了一個 `started` 旗標）。
2. 再部署 Pages（合併 PR）。
3. 驗證：兩個帳號開房、加入，房主按「開始遊戲」，兩邊進入同一張地圖；第三個帳號此時加入會看到「遊戲已開始，無法加入」。

### P5-C 升級（已部署過 P5-B 的人）

1. `npm run deploy:room`（沒有新的 migration、storage 沒有新欄位）。
2. 再部署 Pages（合併 PR）。
3. 驗證：兩個帳號開房、開始遊戲、兩人都按 B 回城 → 兩邊都看得到對方的英雄模型與名牌，走動時位置跟著更新；右上角「隊伍」面板顯示兩人都在「城鎮」；其中一人走傳送門回地城（不必等另一人）。

### P6 升級（已部署過 P5-C 的人）

P6 交易讓 Room Worker **多了 D1 binding**（`workers/room/wrangler.toml` 的 `[[d1_databases]]` `DB`，和 Pages 專案是同一個資料庫 `ember-vault-db`）。

1. 先合併／部署 Pages。舊的 Room Worker 會忽略不認得的訊息類型與多出來的身分欄位，所以「新 Pages + 舊 Worker」只是交易功能暫時沒反應，其他照常。
2. **緊接著** `npm run deploy:room`（沒有新的 D1 migration：`trades` 表 P1 就有；DO migration 也沒有新增）。Worker 部署時會自動把 `DB` 綁上去，不需要在 dashboard 設定。**不要反過來先部署 Worker**：新的 DO 要求身分裡有 `characterId`，舊的 Pages 不會送，所有加入房間的請求都會 400。
3. 驗證：兩個帳號開房、開始遊戲、都回城鎮 → 右上角隊伍面板出現「交易」→ 對方接受 → 各放一些遺物／金幣 → 雙方確認 → 兩邊背包／金幣即時更新；重新整理後（從雲端載入）內容仍相同。

### P7 升級（已部署過 P6 的人）

1. `npm run db:migrate:remote`（新的 D1 migration `0002_room_creates.sql`，建房限流用的 `room_creates` 表）。**要在新 Pages 上線之前跑**；表不存在時建房仍可用（限流查詢失敗只記 log 並放行），但限流不會生效。
2. 部署 Pages（合併 PR）。新 Pages 會多轉送 `x-ev-resume` header；舊 Worker 忽略它，只是房主斷線寬限不可用（房主一斷線照舊立刻關房）、已開始的房間仍拒絕加入。
3. **緊接著** `npm run deploy:room`。P7 沒有新增必填欄位，所以「新 Worker + 舊 Pages」也不會壞：只是沒有 `x-ev-resume`，房主斷線寬限期滿才關房；兩種順序都安全，但為了和 P6 同一個習慣，建議 migration → Pages → Worker。DO migration 沒有新增（`meta` 多了選用欄位 `hostToken`／`hostGoneUntil`，舊房間不受影響）。
4. 驗證：三個帳號開房、開始遊戲，第四個帳號用房號加入 → 直接進入遊戲並出生在城鎮（或沒有門時在本層入口）；關掉一位隊友的網路再恢復 → 顯示「重新連線中…」並以新加入者身分回到城鎮；房主短暫斷網（<15 秒）→ 隊友看到「房主重新連線中…」，恢復後繼續；房主重新整理頁面 → 房間關閉；同一帳號 10 分鐘內第 6 次建房 → 大廳顯示建房太頻繁。

### 之後 Room Worker 有改動時

只要 `workers/room/**` 或 `shared/room.ts` 有變，就要再執行一次 `npm run deploy:room`（Pages 部署不會更新 Worker）。`shared/room.ts` 同時被兩邊使用，改協定時兩邊都要部署。

### 選用：用 Cloudflare Workers Builds 自動部署

不是必須。若不想每次手動 deploy：Cloudflare dashboard → Workers & Pages → `ember-vault-room` → Settings → Builds → 連接 GitHub repo，Root directory 填 `/`，Deploy command 填 `npx wrangler deploy -c workers/room/wrangler.toml`，並把 build watch paths 限制在 `workers/room/**`、`shared/room.ts`。設好之後推到 main 就會自動更新 Worker。

### 注意

- Pages 的**預覽部署**（PR／分支網址）使用同一個 `ember-vault-room`，所以預覽環境與正式環境的房間是共用的。
- 不要在 Pages 專案設 `DEV_AUTH`（見 `docs/p1-setup.md`）。

## 本機開發

需要同時跑三個東西：Room Worker、Pages Functions、Vite。

```bash
npm run db:migrate:local     # 只需第一次
npm run dev:full             # = dev:room（:8787）+ dev:api（:8788）+ Vite（:3000）
```

- `dev:room`：`wrangler dev -c workers/room/wrangler.toml --port 8787 --persist-to .wrangler/state`
- `dev:api`：`wrangler pages dev dist --port 8788 --do ROOM=Room@ember-vault-room --persist-to .wrangler/state`（透過 dev registry 綁到本機的 `ember-vault-room`；**要先有 `dev:room` 在跑**，否則 `/api/rooms` 會 500）
- Vite 已設定 `/api` 代理（含 WebSocket）到 `:8788`，用 <http://localhost:3000> 開遊戲。

**P6：兩個行程要看到同一份本機 D1。** Room Worker 現在也讀寫 D1（交易），而 `db:migrate:local`、Pages 與 Room Worker 都要指到同一個本機資料庫檔。兩個 dev 指令因此都明確帶 `--persist-to .wrangler/state`（相對於專案根目錄，也是 `db:migrate:local` 預設用的位置；`wrangler dev` 不帶時會以設定檔所在的 `workers/room/` 為基準，兩邊就分家了），且兩份 `wrangler.toml` 的 `database_id` 相同。本機資料庫檔在 `.wrangler/state/v3/d1/`（已 gitignore）。若交易回 `server_error`，先確認有跑過 `npm run db:migrate:local`。

### 開發登入：多個帳號

`DEV_AUTH=1` 時 `POST /api/auth/dev` 可帶 body `{ "user": "dev1" }`（`dev1`～`dev8`，其他值回 400；不帶 body 等於 `dev1`，即原本的假帳號）。每個帳號有不同的假 `google_sub`，所以是不同的玩家。

- 登入畫面的「開發登入」旁有帳號下拉選單；也可以用網址 `http://localhost:3000/?devuser=dev2` 預選。
- 同一個瀏覽器的 cookie 只有一個 session。要模擬多人，請用**不同的無痕視窗／瀏覽器設定檔**。
- 每個帳號要有自己的角色（登入後各自建立）。
- 注意：同一個帳號重複加入同一房間時，舊連線會被取代（舊分頁會看到提示並回大廳）。

## 限制與流量預算

房間協定的上限（`shared/room.ts`）：

| 項目 | 值 |
|---|---|
| 人數 | 4 |
| 房號 | 6 碼，大寫英數，排除 `0 O 1 I L` |
| 單則訊息 | 一般 4096 字元；房主與成員的 `loadout` / `handback` 到 32768（超過直接斷線，close 1009） |
| 單連線速率 | token bucket：房主突發 80 則、每秒補 40；成員突發 50、每秒補 30（超過斷線，close 1008） |
| 聊天 | 200 字 |
| 應用層 ping | 每 5 秒一次（用來量延遲、帶上自己最近的 RTT，伺服器回傳全員延遲） |
| 保活 | 每 30 秒送文字 `ping`，由 `setWebSocketAutoResponse` 回 `pong`（不喚醒 DO、不計請求） |
| 閒置清除 | 建立後 2 分鐘內房主沒連上、或所有連線都消失，alarm 會清掉房間 |

Cloudflare 免費方案（數字以官方文件為準：<https://developers.cloudflare.com/durable-objects/platform/pricing/>）：

- Durable Objects 每天 **100,000 次請求**。
- **傳入的 WebSocket 訊息以 20:1 計算**（20 則算 1 次請求）；**送出的訊息與 ping 不計**。WebSocket 連線建立本身算 1 次請求。
- 使用 Hibernation API，DO 閒置時不佔用運算時間。
- 只能用 SQLite 版 Durable Object（所以 migration 用 `new_sqlite_classes`）。

P5-A 的用量估算：4 人房間，每人每 5 秒 1 則 ping ≈ 每小時 4 × 720 = 2,880 則 → 約 144 次請求／小時；聊天另計。一天 100,000 次足夠同時開很多房間。

**P5-C 的實際用量**：城鎮位置每位走動中的玩家約 5 則／秒（站著不送），由 DO 直接廣播所以只算一次傳入；4 人全程一直走動的最壞情況約 3,600 次請求／小時。全員在城鎮、或地城凍結時房主不送快照。實測與估算見 `docs/multiplayer-spec.md` §5.2.1。

**P5-B 的實際用量**（細節與測量方法見 `docs/multiplayer-spec.md` §5.2.1）：
- 傳入 DO 的訊息才計費：房主快照 15 Hz（≈ 54,000 則／小時）＋每位成員「有變化才送」的輸入（最高 20 Hz、沒變化每秒 1 則 keepalive）＋每人每 5 秒 1 則 ping；DO 轉發出去的訊息不計。
- 實測 4 人房間約 **3,900 次請求／小時**（成員輸入以測試腳本的頻率計；保守上限 3 位成員全程 20 Hz 約 13,600 次／小時）→ 免費額度 100,000 次／天約 7–25 個房間小時。

## 已知限制（P5-A / P5-B / P5-C / P6）

- P6：「是否在城鎮」由客戶端回報（城鎮本機模擬，與 `townPos` 同一信任等級）；交易內容與金幣一律由 DO 從 D1 驗證，所以謊報在城鎮最多只能和同房的人開交易視窗，無法憑空產生物品。
- P6：交易草稿只存在 DO 記憶體，DO 被回收會讓進行中的交易取消（客戶端會收到 `expired` 並解鎖），已確認但尚未執行的交易也一併作廢。
- P6：連線在「伺服器已執行、客戶端尚未收到結果」之間斷掉時，客戶端無從得知結果；它離開房間時上傳的舊存檔會因 `save_version` 已前進而被 409 擋下，重新載入即為交易後的存檔。

- P5-B：遊戲開始後不能中途加入（409「遊戲已開始」）。
- P5-C：房主倒地、坐在死亡畫面上而隊友都在城鎮時，地城不算「清空」，隊友這時回來不會讓怪物重生（要等房主按「回到城鎮」）。城鎮裡沒有碰撞：兩個英雄可以疊在一起（本機英雄也看得到對方站在同一格）。

- 沒有自動重連：斷線就提示並回大廳（P7 處理）。
- 房主離開、關分頁或斷線 = 房間結束，沒有房主轉移。
- 一個帳號可以連續建立很多空房間（每個 2 分鐘後被 alarm 清掉）。目前沒有建房頻率限制，朋友間使用可接受；公開使用前需要加。

### 寶箱房升級（migration 0003）

1. `npm run db:migrate:remote`（新的 D1 migration `0003_treasure_pity.sql`，`characters.treasure_pity` 欄位）。**要在合併 `main`（新 Pages 上線）之前跑**：新 Pages 的存檔 UPDATE 會寫這個欄位，欄位不存在會存檔失敗。
2. 部署 Pages（合併 PR）。**不需要 `npm run deploy:room`**：Room DO 只轉送，協定只新增選用欄位，`workers/room`、`shared/room.ts` 都沒有改動。交易 SQL 只動 gold／bag／stash，不影響保底計數。
