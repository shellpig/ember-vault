# P1 帳號＋存檔 — 設定與開發指南

P1 加入 Google 登入、Cloudflare D1 雲端存檔與角色系統（規格見 `docs/multiplayer-spec.md` §1、§2、§8）。
以下是**你需要手動完成**的事項，以及本機開發方式。

## 架構速覽

- 前端：Vite + React（`src/`），登入 / 選角 / 大廳畫面在 `src/components/AccountScreens.tsx`，存檔邏輯在 `src/saveManager.ts`。
- 後端：Cloudflare Pages Functions（`functions/api/**`），資料庫 D1，binding 名稱固定為 `DB`。
- 共用型別：`shared/character.ts`。
- Schema：`migrations/0001_init.sql`。設定檔：`wrangler.toml`。

## 一次性設定

### 1. Google Cloud Console：建立 OAuth Client ID

1. 到 <https://console.cloud.google.com/> 選（或新建）一個專案。
2. 「API 和服務」→「OAuth 同意畫面」：User Type 選「外部」，填應用程式名稱與信箱後儲存（測試中可先留在「測試」狀態，並把自己的 Google 帳號加為測試使用者）。
3. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」→ 應用程式類型選 **網頁應用程式**。
4. **已授權的 JavaScript 來源**加入（不要加路徑、不要結尾斜線）：
   - 正式網域，例如 `https://你的網域`
   - Cloudflare Pages 預設網域 `https://<專案名>.pages.dev`
     - Google 不支援萬用字元；每個預覽網址（`https://<hash>.<專案名>.pages.dev`）要登入的話必須逐一加入，否則預覽環境請改用「開發登入」以外的方式測試或略過。
   - 本機：`http://localhost:3000`（Vite 開發伺服器）
   - 本機：`http://localhost:8788`（`wrangler pages dev` 的 port，若你直接用這個 port 開遊戲）
5. 「已授權的重新導向 URI」不需要填（使用的是 ID token 流程，不是 redirect 流程）。
6. 建立後複製 **Client ID**（形如 `xxxx.apps.googleusercontent.com`）。Client Secret 用不到。

> 本機從 `http://localhost:3000` 開遊戲時，Google 登入按鈕才會出現並可用。若暫時沒有 Client ID，可用下面的「開發登入」。

### 2. 建立 D1 資料庫

```bash
npx wrangler login                       # 第一次使用才需要
npx wrangler d1 create ember-vault-db
```

指令會印出 `database_id`。把它貼到 `wrangler.toml` 的 `database_id`（取代 `REPLACE_WITH_YOUR_D1_DATABASE_ID`）。`database_name`、`binding = "DB"` 不要改。

### 3. 套用 migration

```bash
npm run db:migrate:local     # 本機（存在 .wrangler/state，供 dev:full 使用）
npm run db:migrate:remote    # 遠端（正式 D1）
```

之後新增 migration 檔（`migrations/0002_*.sql`…）時重跑同一組指令即可，已套用的不會重複執行。

### 4. Cloudflare Pages 專案設定

`wrangler.toml` 是設定的唯一來源（D1 binding 與 `GOOGLE_CLIENT_ID` 都寫在裡面），dashboard 上這些欄位會變成唯讀，**不需要在 dashboard 設 binding 或環境變數**。

1. 確認 `wrangler.toml` 的 `database_id` 已填好並 commit。
2. 確認 `[vars]` 的 `GOOGLE_CLIENT_ID` 是你的 Client ID（公開值，可以 commit）。前端由 `GET /api/config` 取得，不需要建置時環境變數。
3. **絕對不要**在 `wrangler.toml` 或 dashboard 設 `DEV_AUTH`（它會啟用不需密碼的假登入端點 `/api/auth/dev`）。
4. 建置設定維持：Build command `npm run build`，Build output directory `dist`。`functions/` 會被 Pages 自動編譯成 Functions。

## 本機開發

建立 `.dev.vars`（已被 git 忽略，供 wrangler 讀取後端環境變數）：

```
DEV_AUTH=1
```

`GOOGLE_CLIENT_ID` 會自動讀 `wrangler.toml` 的 `[vars]`；若要在本機換成別的 Client ID，在 `.dev.vars` 加一行 `GOOGLE_CLIENT_ID=...` 即可覆蓋。

```bash
npm install
npm run db:migrate:local     # 只需第一次（或有新 migration 時）
npm run dev:full             # 同時啟動 wrangler（API，:8788）與 Vite（:3000）
```

開啟 <http://localhost:3000>。Vite 會把 `/api/*` 代理到 `:8788`。

- 開發模式下登入畫面會多一個「開發登入」按鈕，使用固定假帳號（`google_sub = dev-local-user`）。它只在後端 `DEV_AUTH=1` 時有效，否則 `/api/auth/dev` 回 404。
- 只想跑前端、不要 API：`npm run dev`（此時登入會失敗，因為沒有後端）。
- 只跑 API：`npm run dev:api`。
- 型別檢查（前端＋functions）：`npm run lint`。建置：`npm run build`。
- 清空本機資料庫：刪除 `.wrangler/state` 後重跑 `npm run db:migrate:local`。

## 行為說明

- Session：隨機 32 bytes token，DB 只存 SHA-256；cookie `ev_session`（HttpOnly、SameSite=Lax、30 天）。在 `https` 下加 `Secure`；本機 `http` 下不加（否則 Safari 會丟掉 cookie）。
- 存檔時機：進入新樓層、回到城鎮、離開城鎮、死亡、按「角色選單」離開、關閉／離開頁面（`pagehide` → `navigator.sendBeacon` → `POST /api/characters/:id/save`）。地城中途不存。
- 存檔上傳帶 `base_version`；不符回 409，畫面會跳出「存檔版本衝突」，可選擇載入雲端存檔（本次進度不上傳）。存檔失敗（網路錯誤）不會卡住遊戲，HUD 按鈕上會顯示「存檔失敗」，下一個存檔點會再試。
- 起始層數 = 角色 `max_depth`；`max_depth` 只增不減（伺服器取 `MAX(舊值, 新值)`）。
- 死亡流程（P3 已改版，規格 §3.3）：倒地當下先存檔並在原地開傳送門；死亡畫面按「回到城鎮」→ 扣 `depth * 10` 金幣（不足扣到 0）→ 回城鎮滿血並存檔，之後可從城鎮傳送門回到倒地處。死亡不再結束這一局；「回到角色選單」仍可用。背景自動模式（attract）的英雄死亡後 1.5 秒自動重開，不會存檔。
- 後端驗證：角色屬於本帳號、角色上限 8、`equipped ≤ 4`、`bag ≤ 30`、`stash ≤ 200`、`gold ≥ 0`、`potions ≥ 0`、`class_id` 必須是現有職業、遺物 id 不可重複。
