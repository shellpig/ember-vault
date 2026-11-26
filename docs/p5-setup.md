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

- `dev:room`：`wrangler dev -c workers/room/wrangler.toml --port 8787`
- `dev:api`：`wrangler pages dev dist --port 8788 --do ROOM=Room@ember-vault-room`（透過 dev registry 綁到本機的 `ember-vault-room`；**要先有 `dev:room` 在跑**，否則 `/api/rooms` 會 500）
- Vite 已設定 `/api` 代理（含 WebSocket）到 `:8788`，用 <http://localhost:3000> 開遊戲。

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

## 已知限制（P5-A / P5-B / P5-C）

- P5-B：遊戲開始後不能中途加入（409「遊戲已開始」）。
- P5-C：房主倒地、坐在死亡畫面上而隊友都在城鎮時，地城不算「清空」，隊友這時回來不會讓怪物重生（要等房主按「回到城鎮」）。城鎮裡沒有碰撞：兩個英雄可以疊在一起（本機英雄也看得到對方站在同一格）。

- 沒有自動重連：斷線就提示並回大廳（P7 處理）。
- 房主離開、關分頁或斷線 = 房間結束，沒有房主轉移。
- 一個帳號可以連續建立很多空房間（每個 2 分鐘後被 alarm 清掉）。目前沒有建房頻率限制，朋友間使用可接受；公開使用前需要加。
