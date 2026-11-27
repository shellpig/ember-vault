# Agent Instructions

# Embervault

一款支援 **1–4 人合作**的 3D 等角視角（Isometric）程序化地城探索動作 RPG。具備動態提燈陰影、自動探索／戰鬥 AI 與無縫手動接管切換、三職業（燈守戰士／冰雪法師／亞馬遜獵人）、40 層四大區域地城、遺物與套裝系統、城鎮倉庫與雲端存檔。

- **類型**：3D 等角視角動作地城探索（Action Dungeon Crawler / Roguelite Co-op）
- **一句話**：提燈深入 40 層程序化地城——隨時在自動巡航與手動操作間切換，單刷或最多 4 人協力開荒
- **目標平台**：網頁版（PC 瀏覽器優先）
- **當前技術棧**：TypeScript + Vite 8 + React 19 + Tailwind CSS 4 + Three.js + Web Audio；後端 Cloudflare Pages Functions + D1（SQLite）+ 獨立 Worker Durable Objects（SQLite + WebSocket Hibernation）
- **目前階段**：多人連線與雲端存檔路線圖（`P1`～`P7`）進行中，`P1`～`P7` 已合併（P6、P7 待雙瀏覽器驗收）
- **目前進度**：以 `PROJECT_BRIEF.md` 為單一事實來源

## New Conversation Opening Check

開場依下列順序讀：

**Layer 1 — 必讀：**
1. `AGENTS.md`（本檔）
2. `PROJECT_BRIEF.md`（進度、命令與文件索引）
3. `git log --oneline -10`

**Layer 2 — 按任務讀對應段落（勿整份讀，見下方查閱規則）：**
- `docs/multiplayer-spec.md` — 多人連線、帳號存檔、死亡／傳送門、難度縮放、房間架構、交易與 P1～P7 分階段規格的單一來源
- `docs/mage-spec.md` — 冰雪法師職業機制、技能、護盾與遺物特例規格
- `docs/hunter-spec.md` — 亞馬遜獵人弓箭普攻、戰寵、升級與遺物特例規格
- `docs/p1-setup.md` — Google 登入、D1 migration、Pages 設定與本機開發指南
- `docs/p5-setup.md` — Room Worker / Durable Object 部署順序、本機三開開發、多開發帳號與流量預算
- `migrations/0001_init.sql` — D1 資料表 schema（`accounts`、`sessions`、`characters`、`trades`）

**Layer 3 — 按任務查閱實作檔案：**
- `src/game/` — 3D 遊戲引擎（`engine.ts`）、英雄實體（`hero.ts`）、職業數值（`classes.ts`）、地城生成（`dungeon.ts`）、遺物（`relics.ts`）、模型／材質／音效（`models.ts`、`textures.ts`、`audio.ts`、`types.ts`）
- `src/game/engine.ts` — 引擎本體：欄位、建構子、`update` 主迴圈、`tick`、`dispose`、組裝（`export interface EmbervaultEngine extends …Methods` + `Object.assign(EmbervaultEngine.prototype, …)`）。其餘方法分檔在 `src/game/engine/`：
  - 純資料／型別：`data.ts`（Boss 設定與輪替、菁英名、怪物種類判斷、城鎮站點格座標）、`entities.ts`（Enemy／Projectile／Pet／Loot／`LevelCtx`／`Mp*State` 等 interface）、`scratch.ts`（共用暫存向量）
  - 場景與建置：`scene.ts`（渲染器／場景初始化、粒子、環境、牆遮擋、`afterDraw`、鏡頭）、`levelBuild.ts`（`buildLevel`／`clearLevel`）、`town.ts`（`buildTown`／`clearTown`）、`spawn.ts`（`spawnEnemies`／`addEnemy`／深度縮放）
  - 隊伍與流程：`party.ts`（actor 切換、`LevelCtx` 切換、bot、救援）、`travel.ts`（傳送門、回城／回地城、`restartRun`、存檔掛鉤）、`economy.ts`（祭壇、商店、倉庫、遺物裝備／販賣）、`input.ts`（事件綁定、手動控制、輸入鎖）
  - 戰鬥：`heroCombat.ts`（喝藥、衝刺、普攻、劍柄重擊、命中、`damageHero`）、`classSkills.ts`（法師／獵人攻擊、冰霜新星、閃現、戰寵、英雄投射物）、`loot.ts`（`killEnemy`、掉寶、撿取、自動換裝、符文）、`enemies.ts`（怪物 AI、Boss、遠程怪、怪物投射物）
  - 模擬與 UI：`movement.ts`（碰撞、滑動、尋路、脫困）、`ai.ts`（`runAI`、法師戰鬥 AI、bot 跟隨／歸隊）、`frame.ts`（`updateHeroFrame`、背景模擬、目標進度）、`hud.ts`（`emitHud`、小地圖、橫幅、飄字、結算）
  - 多人：`mp/core.ts`（開局／結束、relay、成員、等待畫面）、`mp/host.ts`（房主模擬掛鉤、快照建構）、`mp/guest.ts`（隊友遠端模式、快照套用、預測）、`mp/town.ts`（城鎮位置同步、隊伍資訊、進出城交接）
  - 其他：英雄實體（`hero.ts`）、職業數值（`classes.ts`）、地城生成（`dungeon.ts`）、遺物（`relics.ts`）、模型／材質／音效（`models.ts`、`textures.ts`、`audio.ts`、`types.ts`）
- `src/components/`、`src/App.tsx`、`src/saveManager.ts`、`src/api.ts`、`src/net/roomClient.ts` — UI 畫面、存檔同步與房間 WebSocket 客戶端
- `shared/` — 瀏覽器、Pages Functions 與 Room Worker 共用的型別、協定與上限（`character.ts`、`room.ts`、`game.ts`）
- `functions/` — Cloudflare Pages Functions API（登入、角色 CRUD、存檔、房間開房與 WS 代理）
- `workers/room/` — 獨立私有 Worker `ember-vault-room` 與 `Room` Durable Object

Report to user: current progress, and any issues with their scope of impact.

**Layer 0 — 每個任務開工前先過這張表（不是只有開場）：**

任務屬於下列哪一類，就先讀對應的 skill，再動手。**判斷任務類型是開工的第一步，不是可選項。**

| 任務類型 | 先讀 |
|---|---|
| 規劃遊戲規格、Phase 規劃、平衡調整、帶 code review 的驗證 | `gamestudio` |
| 診斷 bug、分析錯誤、找根因、效能回歸 | `diagnose` |
| 需求不清、規格討論、要問釐清問題 | `grill-me` |
| 前端／本機 web app 驗證、UI 行為除錯、瀏覽器截圖或 console log | `webapp-testing` |

四個 skill 已用 junction 同時掛進 `~/.claude/skills/` 與 `~/.agents/skills/`。前者供 Claude 使用；後者供支援 Agent Skills 的其他 agent（包含 Codex）發現。**出現在 session 的技能清單時直接用 skill 名字叫**。原始檔仍在 `C:\_work\AI_Work\Skills\`（改那邊就等於改這邊）；環境沒掛 junction 時退回讀檔：

- `gamestudio` → `Skills\gamestudio\SKILL.md`
- `diagnose` → `Skills\engineering\diagnose\SKILL.md`
- `grill-me` → `Skills\productivity\grill-me\SKILL.md`
- `webapp-testing` → `Skills\engineering\webapp-testing\SKILL.md`

## 文件查閱規則

除了 `AGENTS.md` 與 `PROJECT_BRIEF.md`（開場整份讀），**其他文件一律標題 grep 定位、只讀該段**（讀到下一個同級標題為止）。

**不要依賴行號**——行號隨編輯漂移，一律以標題或關鍵字定位。

各文件的定位鍵：

| 文件 | 定位鍵 | 例 |
|---|---|---|
| `docs/multiplayer-spec.md` | 章節號 `## 0.`～`## 10.` 或階段名 `P5-B` | `rg -n '^#{2,3} ' docs/multiplayer-spec.md` |
| `docs/mage-spec.md` | 機制章節 `## 0.`～`## 8.` | `rg -n '^## ' docs/mage-spec.md` |
| `docs/hunter-spec.md` | 機制章節 `## 1.`～`## 7.` | `rg -n '^#{2,3} ' docs/hunter-spec.md` |
| `docs/p1-setup.md` | 設定與行為小節 | `rg -n '^#{2,3} ' docs/p1-setup.md` |
| `docs/p5-setup.md` | 部署、本機開發、流量預算、已知限制 | `rg -n '^#{2,3} ' docs/p5-setup.md` |

## 文件分工與單一事實來源

**同一件事只住一個地方。**

| 住哪 | 放什麼 | 例 |
|---|---|---|
| **`PROJECT_BRIEF.md`** | 全案目前進度、指令速查與文件索引 | P1～P7 狀態與近期動態 |
| **`docs/multiplayer-spec.md`** | 多人連線、帳號存檔、死亡／傳送門、縮放、交易與分階段設計 | 房主權威架構、DO 流量預算、§10 待決項 |
| **`docs/mage-spec.md`** | 冰雪法師玩法規則與設計說明 | 冰尖彈循環、Frost Nova、護盾回充規則 |
| **`docs/hunter-spec.md`** | 亞馬遜獵人玩法規則與設計說明 | 獵手箭矢、戰寵召喚／強化與生命週期 |
| **`src/game/classes.ts`** | **所有職業遊戲數值的單一來源** | `HERO_CLASSES`、`FROST_MAGE` 係數與升級上限 |
| **`src/game/engine.ts` + `src/game/engine/**`** | **引擎狀態（欄位）住 `engine.ts`，方法按領域住 `engine/<module>.ts`** | 傳送門／回城在 `travel.ts`、怪物 AI 在 `enemies.ts`、多人快照在 `mp/host.ts`／`mp/guest.ts` |
| **`shared/character.ts`、`shared/room.ts`、`shared/game.ts`** | **前後端與 DO 共用型別、上限與訊息協定** | 角色／背包／倉庫上限、房間與遊戲同步訊息型別、速率／大小上限與錯誤碼 |
| **`docs/p1-setup.md`、`docs/p5-setup.md`** | 雲端設定、部署順序與本機開發步驟 | D1 migration、`deploy:room`、`DEV_AUTH` |
| **`wrangler.toml`、`workers/room/wrangler.toml`** | Cloudflare binding 與公開設定 | D1 `DB`、`ROOM` binding、`GOOGLE_CLIENT_ID` |

## 修改授權與驗證規則

（單一事實來源；其他文件不重複本節內容。）

除非使用者明確要求「修」、「修改」、「實作」、「處理某個 phase」、「commit」或「提交」，否則不得：

- 修改任何程式碼、文件或設定檔
- 自行套 patch
- stage 檔案
- 建立 commit

當使用者要求「驗證」，或只是描述錯誤、貼截圖、詢問原因、要求解釋、要求列出問題、詢問某功能怎麼使用時：只能進行檢查、讀檔、執行測試、code review、啟動本機服務與回報結果。若發現問題，只列出問題、影響範圍與建議修法，等待使用者下一步指示。

(English mirror: only modify files when the user explicitly requests fix / implement / commit. Verify / diagnose = report only.)

## 設計討論的方式

**每個問題都要先想好一個解法再拿出來討論。** 不要把開放題原封退回給使用者。

- 有多種讀法時，把選項連同取捨一起端出來，並且**給出推薦**。
- 發現設計有洞時，講清楚**影響範圍**（單人／多人、城鎮／地城、D1 存檔／DO 流量、哪個既有規則會被打到），不要只說「這裡怪怪的」。
- 使用者重申某個決定時，那就是拍板；照做，不要重新辯論。

## 實作守則

1. **API 與型別簽名預先核對**：呼叫專案內引擎方法、API 端點或共用協定前，先 grep / 讀檔核對最新定義（特別是 `shared/character.ts`、`shared/room.ts`、`shared/game.ts` 與 `src/game/engine.ts`），不憑記憶編寫。
2. **三端型別檢查與建置同 turn 修完**：任何程式修改後必跑 `npm run lint`（涵蓋前端、`functions/`、`workers/room/` 三份 `tsconfig.json`）與 `npm run build`；有錯就在同一個 turn 內修到通過，不讓編譯錯誤流向使用者。
3. **單人模式零連線原則**：單人遊玩永遠只跑本機引擎，**不建立房間、不連 WebSocket、不消耗 Durable Object 額度**；但地城邏輯與多人共用 `heroes[]`。
4. **安全與信任邊界**：
   - `workers/room/` 不公開路由（`workers_dev = false`），DO 只信任 Pages Function 驗證 session 與角色後塞入的 `x-ev-identity` header，不信任任何瀏覽器自報身分欄位。
   - **絕不可**在 `wrangler.toml` 或正式環境設定 `DEV_AUTH`（僅限本機 `.dev.vars`）。
   - `shared/` 檔案必須保持純 TS，不得引用 DOM 或 Workers 專屬 API。
   - **倉庫不上網**：最多 200 件遺物的 `stash` 不經由遊戲同步訊息傳送，永遠留在擁有者端並由擁有者自行存檔。
5. **Cloudflare 免費方案流量預算**：Durable Object 傳入 WebSocket 訊息以 20:1 計費（送出與 auto-response 保活不計費）。多人同步須遵守：**成員輸入有變化才送（上限 20 Hz、靜止 1 Hz keepalive）、房主增量快照上限 15 Hz、城鎮 `townPos` 有移動才送（上限 5 Hz）並由 DO 直接扇出不經房主**（P5-B 實測 4 人房約 3,900 次請求／小時），避免超量。
6. **部署相依提醒**：只要改動 `workers/room/**` 或 `shared/room.ts`，必須在部署 Pages 之前或同時執行 `npm run deploy:room` 更新 Room Worker，Pages 部署不會自動更新 Worker。
7. **規格與實作同步**：數值、協定或行為若與 `docs/multiplayer-spec.md`、`docs/mage-spec.md`、`docs/hunter-spec.md` 出現變動，於同次交付同步更新對應段落與 `PROJECT_BRIEF.md`。
8. **引擎方法放哪**：`EmbervaultEngine` 的方法住在 `src/game/engine/<module>.ts`（方法物件，第一個參數 `this: EmbervaultEngine`，只 `import type` 引擎；`engine.ts` 以宣告合併＋`Object.assign(EmbervaultEngine.prototype, …)` 掛回）。**新方法放進對應領域的模組**（不要塞回 `engine.ts`）；新模組要在 `engine.ts` 的組裝區塊補上 `import`、`type`、`interface extends` 與 `Object.assign` 四處。方法不可用「預設參數引用 `this`」（例如 `hero: Hero = this.hero`，會造成 TypeScript 循環推導），這類方法留在 `engine.ts`；新方法請補明確回傳型別。純搬移（不改邏輯）的重構以 `node scripts/verify-engine-split.mjs` 驗證（以 `origin/main` 為基準逐方法比對）。

---

## 本機 Windows 環境專用

> 本段僅適用於使用者本機 Windows 環境（工具都在 `C:\`）。**remote / CI / Linux session 沒有這些路徑與工具，跳過本段**。

### Project Skills

原始檔住 `C:\_work\AI_Work\Skills\`；四個 skill 已用 junction 掛進 `~/.claude/skills/` 與 `~/.agents/skills/`（`gamestudio`、`diagnose`、`grill-me`、`webapp-testing`）。`.claude/skills` 供 Claude 使用；`.agents/skills` 供支援 Agent Skills 的其他 agent（包含 Codex）發現。改原始檔等於改兩邊掛進去的同一份。

**觸發表已搬到 `New Conversation Opening Check > Layer 0`，本節不重複。**

### DeepSeek Codex CLI Reviewer

使用者說「要 ds4 pro 做 XXX」「要 ds4 flash 做 XXX」時，透過本機 Moon Bridge DeepSeek 設定走 Codex CLI。

Model mapping：`ds4 pro` → `deepseek-v4-pro`；`ds4 flash` → `deepseek-v4-flash`；只說 `ds4` 用 `deepseek-v4-pro`。

Default mode: read-only reviewer.
- 用 `CODEX_HOME=C:\_work\AI_Work\Tools\codex-deepseek-home`。
- 不寫檔、不刪檔、不 stage、不 commit、不 push。
- 不讀 `.env`、`.dev.vars`、`C:\_work\AI_Work\Tools\`。
- 結果當第二意見，回報前先自己審一遍。
- 非互動呼叫（`codex exec`）必須 `< NUL` 關閉 stdin，否則會停在 `Reading additional input from stdin...` 永久卡死。

### Antigravity CLI (agy) Reviewer

使用者說「要 agy 做 XXX」「用 agy 審 / 驗證 XXX」時走 `agy`。

本機統一使用共用 Python 控制器 `C:\_work\AI_Work\Tools\agent-worker\worker.py`，以工具自己的 `.venv\Scripts\python.exe` 執行。各 agent 可先讀共用 [agent-worker skill](C:/_work/AI_Work/Skills/engineering/agent-worker/SKILL.md)。不再手寫 `cmd /c`、stdin 重導或另一層背景啟動。

Default mode: read-only reviewer.
- prompt 內明確要求：不建立 / 修改 / 刪除任何檔案、不跑會寫檔的命令、輸出純文字報告。
- 使用控制器的 `--mode review`；只有使用者已授權實作時才改用 `--mode implement`。
- 跑完必以 `git status` / `git diff` 確認實際改動；agy 的口頭回報不可作為改動依據。

### Codex CLI (OpenAI) Reviewer

使用者說「要 codex 做 XXX」「用 codex 審 / 驗證 XXX」（不帶 `ds4`）時，用預設 `CODEX_HOME` 走 `codex exec`。

```powershell
cmd /c "codex exec `"<任務>`" --sandbox read-only -C `"E:\AI_Work\projects\ember-vault`" --ephemeral -o `"<結果檔>`" < NUL > `"<過程log檔>`" 2>&1"
```

- `< NUL`：非 TTY 下會停在 `Reading additional input from stdin...` 永久卡死。
- `--sandbox read-only`：引擎層強制唯讀；寫入任務改 `--sandbox workspace-write`。
- `-o <結果檔>`：只寫最終回覆，與 stdout 的完整過程 log 分離。

Model selection：預設 `gpt-5.5` + `model_reasoning_effort = "high"`（來自 `~/.codex/config.toml`）。要換模型用 `-m <model>`，專注程度用 `-c model_reasoning_effort="low/medium/high"` 覆蓋。

Default mode: read-only reviewer；結果當第二意見。
