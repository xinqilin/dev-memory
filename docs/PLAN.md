# dev-memory：團隊共用開發記憶 + LLM 維護的 Wiki（跨 repo，Claude Code 與 Codex CLI 共用）

## Context

現在的流程是：claude-mem 蒐集 → `/n8n-doc-sync` → n8n 呼叫 LLM → 建 GitHub branch → Google Chat → Apps Script 審核 → 開 PR。這條流程只有 Bill 自己能用，主管希望做成團隊能安裝的產品。

討論後確認的需求：
1. 開發細節要**長期保存**（至少一年），不能跟著 transcript 14 天後被清掉。
2. 搜尋要準，中文跟英文識別字混在一起也要找得到。
3. 每個人在**本機**跑輕量 DB，不需要中央共用的 DB。
4. 每個人把自己的記憶用 **PR 提交**到團隊 repo，隊友 sync 後在自己的本機也搜得到。
5. 參考 llm_wiki / Karpathy LLM Wiki：原始記憶之上加一層 **LLM 維護的 wiki**，這層 wiki 就是文件。
6. **跨 repo 記憶**：一個功能常常橫跨 batch、api、frontend 等多個 repo。
7. **同一個 plugin，Claude Code 跟 Codex CLI 都能用**，而且兩邊共用同一份記憶。
8. **語意搜尋讓使用者自己選**：要不要裝 Ollama、要用哪個 embedding 模型（例如 qwen3-embedding 的哪個版本）。
9. 拿掉 n8n 跟 Apps Script；push 跟開 PR 由使用者自己執行（CLAUDE.md 規定）。
10. **PR 送出前要能預覽和修改**，體驗不能輸給 Apps Script：左邊編輯、右邊即時預覽。另外要能一次看多頁、跟 main 比對、看到內容的來源紀錄。
11. 開發目錄：`/Users/bill.lin/project-plugin`。

## 一句話架構

**正本放在 git repo；本機 SQLite 只是索引，壞了可以重建；LLM 直接用 Claude Code 或 Codex。** 核心（CLI、MCP、DB）跟工具無關，每個工具只需要一層很薄的 adapter（manifest、hooks、transcript 解析）。語意搜尋是選配，使用者自己決定裝不裝。

```
Claude Code ─┐ hooks                                 ┌─ memory_search (MCP) / dev-memory search (CLI)
Codex CLI  ──┴───────> dev-memory CLI（核心） ──> ~/.dev-memory/memory.db（turn | record | page | fts | vector）
                           │                                  ▲            ▲
                           │                                  │ sync       │ 選配：Ollama embedding
   skills: mem-save / wiki-ingest / wiki-lint / mem-setup     │            │ （使用者用 /mem-setup 選）
                           ▼                                  │
        memory repo worktree ─> 本機審核頁（編輯 + 預覽 + diff）─commit─>（使用者按送出）publish ─> PR ─CI─> main ─> 隊友 sync
```

## 兩個工具的相容性（已查官方文件，並對照本機檔案）

| 元件 | Claude Code | Codex CLI（本機 0.154.0） | 做法 |
|---|---|---|---|
| Plugin manifest | `.claude-plugin/plugin.json` | 根目錄 `plugin.json`（`$schema` agent-plugins 1.0.0），舊版的 `.codex-plugin/plugin.json` 也支援 | 兩份並存 |
| Marketplace | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json`，找不到時會退回讀 `.claude-plugin/marketplace.json` | 同一個 repo 放兩份 |
| Skills | `skills/<name>/SKILL.md` | 格式相同（open standard） | **共用**，內容不能寫死任一邊專屬的 tool 名稱 |
| MCP | `.mcp.json`（`args` 用 `${CLAUDE_PLUGIN_ROOT}`） | **只讀** `mcp.json`，不讀 `.mcp.json`；要寫 `type: "stdio"`；`command` 不展開變數，`args` 展開 `${PLUGIN_ROOT}`（Phase 0 實測） | 兩份，指向同一個 stdio server；`command` 用裸名稱 `bun`，所以 PATH 裡要有 bun |
| Hooks | `hooks/hooks.json` | `hooks/hooks.json`，或在 manifest 的 `extensions."com.openai".hooks` 覆寫 | Phase 0：格式相同，共用一份（用 `${CLAUDE_PLUGIN_ROOT}`）；Codex 端待 session 實測，失敗就拆成兩份 |
| 安裝 | `--plugin-dir` 或 `plugin install` | `marketplace add` 之後還要 `plugin add <plugin>@<marketplace>`；會**複製**到 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/` | git 來源不會有 `node_modules` → MCP server 要零依賴或打包成單檔 |
| 環境變數 | `CLAUDE_PLUGIN_ROOT` | `PLUGIN_ROOT`，同時也有 `CLAUDE_PLUGIN_ROOT` | 用 `CLAUDE_PLUGIN_ROOT` |
| 事件 | SessionStart / Stop / PreCompact / SessionEnd（預設 1.5 秒） | 同樣四個事件，但 SessionEnd 預設 1 秒、最多 3 秒 | **主要靠 Stop 做增量存檔**，SessionStart 補掃漏掉的，SessionEnd 能做多少算多少 |
| Hook 收到的資料 | `session_id`、`transcript_path`、`cwd` | 同樣欄位，但 `transcript_path` 可能是 null，官方也說格式不穩定 | 是 null 時改掃 `~/.codex/sessions/**` |
| Transcript 格式 | `~/.claude/projects/<slug>/*.jsonl`，每行都有 cwd、gitBranch、uuid | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`：`session_meta.git`、`event_msg`、`response_item` | 寫兩個 parser，輸出同一種 `turn` 格式 |
| Hook 信任 | 裝好就會執行 | **要使用者手動信任**才會執行 | 寫進 README |
| 使用者設定 | `userConfig` | 官方文件沒寫 | **兩邊都不用**，統一讀 `~/.dev-memory/config.toml` |
| 資料位置 | `CLAUDE_PLUGIN_DATA` | `PLUGIN_DATA`（跟 Claude Code 是不同目錄） | **兩個都不用**，固定放 `~/.dev-memory/` |

**怎麼知道改了哪些檔案**：Codex 常用 `exec_command` 改檔，從 tool call 看不出來。所以主要用 git 判斷：session 開始時的 commit 到 HEAD 的 diff，加上 working tree 的變更。

## 用到的應用程式

| 元件 | 用途 | 狀態 |
|---|---|---|
| Claude Code plugin + Codex plugin（同一份原始碼、兩份 manifest） | 蒐集、萃取、ingest、搜尋 | 必要 |
| Bun + `bun:sqlite` | CLI、MCP server、本機索引。macOS 用**系統** SQLite（Phase 0 實測 3.51.0 有 FTS5），Linux/Windows 用 Bun 自帶的；`dev-memory init` 要檢查 `ENABLE_FTS5` | 必要（`brew install bun`，PATH 裡要有 `bun`） |
| git + `gh` | 同步 memory repo、開 PR；用 `gh auth login` 或 SSH 認證，**不需要 PAT** | 必要 |
| GitHub 私有 repo ×3 | ① plugin／marketplace：`xinqilin/dev-memory`（已建，private；未來搬 104corp）<br>② 測試記憶：`xinqilin/dev-memory-test`（假資料，已建）<br>③ 正式記憶：沿用既有的 `104corp/104mis-billing-doc` | 必要 |
| GitHub Actions | gitleaks 掃全 repo；結構 lint **只掃 `wiki/` 與 `records/`**（用內建的 `GITHUB_TOKEN`）。既有文件沒有 frontmatter，不納入 lint | 必要 |
| Ollama + embedding 模型（qwen3-embedding 0.6b/4b/8b 或 bge-m3） | 語意搜尋，向量存在 SQLite | **使用者自己選**，預設不裝；見下方「語意搜尋選配」 |
| claude-mem | **不使用**，Phase 5 驗收後停用 | 退場 |
| Chroma | **不使用**：它只負責存向量、找相近向量，這件事 SQLite 就能做；而且它預設的模型 all-MiniLM-L6-v2 是英文模型，又要額外開一個 Python 程序 | 不用 |
| n8n / Apps Script / Google Sheet | 改用本機審核頁加 PR 流程（審核頁沿用 Apps Script `Page.html` 的版面） | 退場 |
| sqlite-vec | 還在 alpha；macOS 內建的 SQLite 不能載入 extension | Phase 6 選配 |
| RDS PostgreSQL 16/17 + pgvector 0.8.2 + pg_bigm | 中央搜尋索引 | Phase 6 選配 |

**不用 claude-mem 的原因**（都有實測或查證依據）：
- **中文搜不到**：FTS5 預設 tokenizer 不會斷中文，`MATCH '例外'` 只找到 1 筆，實際有 10 筆。
- **萃取時漏掉決策**：#3727 用英文摘要，把關鍵決策漏掉了。
- **認不出同一個 repo**：`project` 用目錄名稱，換機器或跨 repo 就對不上。
- **只支援 Claude Code**。
- **資源重**：observer 一直在背景耗 token，Chroma 加 SQLite 合計約 1.3GB。

**本機不用 PostgreSQL 的原因**：
- **資料量小**：推測一個人一年一萬筆以內，SQLite 就夠。
- **PG 的強項用不到**：共用已經交給 git，不需要多人同時連線。
- **本機版缺 pg_bigm**：PGlite 跟 Homebrew 都沒有 pg_bigm，中文關鍵字搜尋少了關鍵 extension。
- **搜尋準不準跟 DB 無關**，取決於三件事：先整理好的 wiki、關鍵字搜尋、使用者自己選的 embedding 模型。

## 語意搜尋選配：使用者自己決定要不要裝 Ollama、用哪個模型

### 原則
- **預設 `none`**：只用關鍵字搜尋，什麼都不用裝就能用。
- **plugin 不會自己安裝軟體**：`/mem-setup` 只負責偵測環境、給建議、列出指令，由使用者自己執行（或使用者同意後由 AI 代為執行）。
- **每個人可以選不同模型**：向量不進 repo，每個人在本機用自己選的模型計算，不會互相衝突。
- **兩個工具共用設定**：Claude Code 跟 Codex 都讀 `~/.dev-memory/` 裡的設定跟向量，設定一次兩邊都生效。

### 可選的模式

下載大小已查過 Ollama library。RAM 建議只是起始值，Phase 4 實測後修正。

| 模式 | 下載大小 | 起始建議 |
|---|---|---|
| `none`：只用關鍵字 | 0 | 預設。RAM 8GB、Intel Mac，或不想多跑一個常駐服務 |
| Ollama + `qwen3-embedding:0.6b` | 639MB | 16GB，例如 Bill 的 M2 16GB |
| Ollama + `bge-m3` | 約 1.2GB | 16GB 以上，當對照組 |
| Ollama + `qwen3-embedding:4b` | 2.5GB | 32GB 以上（推測） |
| Ollama + `qwen3-embedding:8b` | 4.7GB | 64GB 以上（推測） |

### `/mem-setup` 流程

CLI 版是 `dev-memory setup`；也可以用 `--embedding none|ollama --model <tag>` 非互動執行。

1. **偵測環境**：OS、晶片（Apple Silicon 或 Intel）、RAM；有沒有裝 `ollama`；`127.0.0.1:11434` 有沒有在跑；已經下載哪些模型（`/api/tags`）。
2. **讓使用者選**：列出上面的表，標出建議選項。
3. **沒裝 Ollama 時**：列出安裝指令（macOS 是 `brew install ollama`，再 `brew services start ollama`；其他 OS 給官方連結），由使用者執行，或使用者同意後代為執行。
4. **模型還沒下載時**：`ollama pull <tag>`，同樣由使用者執行或同意後代為執行。
5. **健康檢查**：embed 一句測試文字，把耗時、維度、`ollama ps` 的記憶體用量顯示給使用者看。
6. **寫設定並開始計算**：寫入 `~/.dev-memory/config.toml`，把所有紀錄跟頁面放進 `embed_queue`，在背景計算並顯示進度。
7. **之後要換模型或關掉**：再跑一次 `/mem-setup`。
   - 換模型：重算全部向量。
   - 改回 `none`：向量表保留但不再使用，並提示可以用 `ollama rm <tag>` 釋放磁碟空間。

```toml
# ~/.dev-memory/config.toml
[embedding]
provider = "ollama"                 # "none" | "ollama"
model = "qwen3-embedding:0.6b"
endpoint = "http://127.0.0.1:11434"
```

### 執行時的行為（已查 Ollama API 文件與 Qwen3-Embedding 模型卡）

- **什麼時候算向量**：寫入紀錄或頁面、sync 匯入、查詢時才算。hook 存原始對話時**不算**。
- **批次送出**：`/api/embed` 的 `input` 可以放陣列，一次送多筆。
- **統一用 1024 維**：請求帶 `dimensions: 1024`。qwen3-embedding-0.6B 原生就是 1024 維（MRL 可設 32–1024）；4b/8b 用 MRL 降到 1024；bge-m3 原生 1024 維。好處是換模型時儲存格式不變，一萬筆約 41MB。Phase 4 要驗證 Ollama 對每個模型都有照這個參數輸出。
- **查詢要加前綴**：Qwen3-Embedding 查詢時要用 `Instruct: {task}\nQuery: {query}`，文件本身不用加；不加前綴準確度會掉 1–5%。bge-m3 不需要。由 provider 依模型處理。
- **用完就釋放記憶體**：每次請求帶 `keep_alive: "30s"`（Ollama 預設是 5 分鐘）。
- **相似度計算**：Ollama 回傳的向量已經 L2 正規化，所以 cosine 就等於內積，逐筆算即可。
- **混合排序**：關鍵字前 20 筆加向量前 20 筆，用 RRF 合併；還沒算好向量的項目只會出現在關鍵字那邊。
- **自動降級**：Ollama 沒開、模型不見或逾時，這次搜尋就改成只用關鍵字，並附一行提醒；**絕不擋住 hook 或 session**。SessionStart 會顯示目前的搜尋模式跟狀態。
- **模型更新就重算**：記錄模型 digest（`/api/tags`），digest 變了就排程重算。

## 本機審核頁（取代 Apps Script）

### `/wiki-ingest` 的完整流程（不會直接開 PR）
| 步驟 | 發生什麼事 | 使用者要做什麼 |
|---|---|---|
| 1. 候選紀錄 | AI 從對話整理出卡片（原因、決定、放棄的方案），列在對話裡 | **確認點 ①**：刪掉或修改 |
| 2. 整理計畫 | AI 列出要新增哪些頁、更新哪些頁、哪個舊決策被取代 | **確認點 ②**：同意或調整 |
| 3. 產生草稿 | AI 在獨立的 worktree 寫頁面（不會動到使用者手上的 repo），同時檢查 secret 跟個資 | 不用做事 |
| 4. 審核頁 | 自動在瀏覽器打開本機審核頁 | **確認點 ③**：預覽、修改、核准 |
| 5. 送出 | 使用者在審核頁按「送出 PR」或自己執行 `dev-memory publish`，才會 push 並開一般 PR（不開 Draft） | **使用者自己按** |

AI 從頭到尾都不會自己 push。

### 畫面
```
dev-memory 審核  |  branch: mem/bill.lin/20260917-sap-create-bu-data
-------------------------------------------------------------------------------
這次改到的頁面               | 編輯（左）                 | 預覽（右）
  [新增] decisions/erp-...   | type: decision             | ErpDataRecordType 未知 type
  [更新] features/sap-...    | ## 原因                    | 原因：多筆未知 type 要彙總...
  [更新] index.md            | ...                        |
-------------------------------------------------------------------------------
分頁：[編輯/預覽] [跟 main 比較] [來源紀錄] [檢查結果]
按鈕：[捨棄這頁]                              [核准並 commit]   [送出 PR]
```

### 功能
- **左邊編輯、右邊即時預覽、捲動同步**：直接沿用 `~/Desktop/appscript/Page.html` 的版面跟已經修好的地方（包括 grid 欄位設 `min-width: 0` 防止跑版）。
- **頁面清單**：列出這次 ingest 新增或更新的所有頁面（含 `index.md`），並標示是新增還是更新。
- **跟 main 比較**：更新既有頁面時，可以看到跟 `origin/main` 目前版本的差異，知道 AI 改了哪幾句。
- **來源紀錄**：依 frontmatter 的 `sources[]` 列出這頁引用了哪些紀錄卡片。
- **檢查結果**：顯示 secret 跟個資掃描、frontmatter 格式檢查的結果；有問題時「核准」按鈕不能按。
- **捨棄這頁**：還原成 main 的版本；如果是新增的頁面就直接刪掉，同時更新 `index.md`。
- **核准並 commit**：在 worktree 裡 commit，這時還沒上 GitHub。
- **送出 PR**：執行 `publish`（`git push` 加 `gh pr create`），完成後顯示 PR 連結並關閉伺服器。
- **三種改法改的是同一份檔案**：在審核頁改、在對話叫 AI 改、用 IDE 改都可以。

### 技術設計
- **啟動**：`/wiki-ingest` 在背景執行 `dev-memory review --branch <branch>`，印出網址，並用 `open`（macOS）或 `xdg-open`（Linux）打開瀏覽器。
- **伺服器**：用 `Bun.serve`，只綁 `127.0.0.1`，port 隨機。網址帶一次性 token，所有 API 都要驗 token，避免其他網頁或本機程式亂打 API（CSRF）。
- **API**：
  - `GET /api/pages`：頁面清單
  - `GET /api/page?path=`：內容、main 版本、sources、檢查結果
  - `PUT /api/page?path=`：存檔，要帶 `base_hash`
  - `POST /api/discard?path=`：捨棄這頁
  - `POST /api/approve`：先檢查再 commit
  - `POST /api/publish`：送出 PR
  - `GET /api/events`：SSE，檔案被外部修改時通知頁面
- **自動存檔**：停止輸入 800ms 後存回檔案。磁碟上的檔案才是正本。
- **跟 AI、IDE 的修改同步**：監看 worktree 的檔案變化，用 SSE 通知頁面。
  - 頁面沒有未存的修改：自動重新載入。
  - 頁面有未存的修改：顯示「檔案被外部修改：重新載入 / 保留我的版本」。
  - 存檔時比對 `base_hash`，不會不知不覺蓋掉別人的修改。
- **前端**：純 HTML、CSS、JS，不用框架。`marked`、`diff`、`dompurify` 直接打包進 plugin，不走 CDN，公司網路擋外部連線也能用。預覽前先用 DOMPurify 清掉危險內容，避免 markdown 裡夾帶的 HTML 執行 script。版本實作時用 context7 確認。
- **什麼時候關閉**：送出或全部捨棄後自動關閉；閒置 30 分鐘自動關閉；同一個 branch 重複啟動時，沿用已經在跑的伺服器。
- **兩個工具都能用**：審核頁就是一般網頁，跟用 Claude Code 還是 Codex 無關。
- **push 規則**：只有使用者自己按「送出 PR」或自己執行 `publish` 才會 push。skill 裡要寫明 AI 不能呼叫 `/api/publish`。

## 跨 repo 設計

1. **Repo ID**：統一轉成 `104corp/104mis-billing-batch-aws` 這種格式。Claude Code 從 `git remote get-url origin` 取；Codex 從 `session_meta.git.repository_url` 取。不在 git 裡的目錄 ID 是 `null`，預設不提交。
2. **產品登錄表** `repos.yaml`（放在 memory repo）。memory repo 沿用 `104mis-billing-doc`，**只放 billing**，所以目前只登記 billing 底下的 code repo；crm、aisr 等其他產品要用時另外開一份 memory repo，不 rename 也不混進來：
   ```yaml
   products:
     billing:
       repos: [104corp/104mis-billing-api-aws, 104corp/104mis-billing-batch-aws,
               104corp/104mis-billing-backend-aws, 104corp/104mis-billing-frontend-aws]
   ```
3. **一段對話可能碰到多個 repo**：每輪對話依 `cwd` 判斷 repo；改過的檔案往上找 `.git` 對應到 repo。所以一筆紀錄的 `repos[]` 可以有多個。
4. **wiki 依產品跟主題分**：
   - `features/<slug>.md`：一個功能在各 repo 分別做了什麼
   - `entities/{tables,apis,queues,external}/<name>.md`：誰寫、誰讀
   - `repos/<repo>.md`：這個 repo 負責什麼
5. **搜尋排序**：同 repo > 同產品 > 全部；wiki 頁 > 紀錄 > 原始對話；已被取代的內容不列出。
6. **自動歸成同一個功能**：同產品底下 branch 名稱主幹相同，或提到同一個 entity，ingest 會提議歸在一起，由作者確認。
7. **偵測文件過時**：`/wiki-lint` 用 `gh api repos/{repo}/commits?path=&since=` 比對 `code_refs` 列的檔案有沒有更新過，不需要在本機 clone 其他 repo。

## 開發目錄結構：`/Users/bill.lin/project-plugin`

```
project-plugin/
├── AGENTS.md / CLAUDE.md(@AGENTS.md)
├── docs/{PLAN.md, HANDOFF.md, eli5.html, spikes/phase-0.md}
├── .claude-plugin/marketplace.json
├── .agents/plugins/marketplace.json
├── plugins/dev-memory/
│   ├── .claude-plugin/plugin.json
│   ├── plugin.json
│   ├── hooks/hooks.json
│   ├── .mcp.json
│   ├── mcp.json
│   ├── skills/
│   │   ├── mem-save/SKILL.md
│   │   ├── wiki-ingest/SKILL.md
│   │   ├── wiki-lint/SKILL.md
│   │   └── mem-setup/SKILL.md        # choose search mode: none / ollama + model
│   ├── src/
│   │   ├── cli.ts                    # init | setup | archive | sweep | sync | search | embed | export | review | publish | lint-structural | eval
│   │   ├── mcp-server.ts             # memory_search, memory_get
│   │   ├── core/{db,tokenize,search,repo-id,git-files,config}.ts
│   │   ├── core/embedding/{provider,none,ollama}.ts
│   │   ├── review/server.ts          # Bun.serve on 127.0.0.1, token auth, SSE file watch
│   │   ├── review/ui/{index.html,app.ts,style.css}   # layout from appscript Page.html; marked + diff + dompurify bundled
│   │   └── adapters/{claude-code,codex}.ts
│   ├── test/fixtures/{claude-code,codex}/
│   └── package.json / bun.lock / tsconfig.json
└── templates/memory-repo/{schema.md, repos.yaml, wiki/, eval/, .github/workflows/lint.yml}
```

## 資料格式

### Memory repo（沿用既有的 `104corp/104mis-billing-doc`，就地加目錄）
```
104mis-billing-doc/
├── README.md, maintenance/, spec/, guidelines/, bank/, dr/, poc/, config/   ← 既有 39 份，原地不動
├── wiki/
│   ├── index.md            ← 總目錄，同時連到既有文件
│   ├── log.md              ← 變更紀錄
│   └── billing/{overview.md, features/, decisions/, entities/, repos/, runbooks/}
├── records/<product>/<yyyy-mm>/<author>.jsonl   ← 只新增、不修改；一人一月一個檔
├── schema.md               ← 規則，取代原本放在 n8n 的 prompt
├── repos.yaml              ← 產品跟 repo 的對應（目前只有 billing）
├── .gitattributes          ← records/** linguist-generated=true，讓 GitHub 摺疊 JSONL diff
└── .github/workflows/lint.yml
```
- **為什麼沿用而不另開**：舊流程（n8n、Apps Script）已停用，不會跟記憶 PR 打架；既有文件的 commit 歷史跟連結都留著，也省掉「匯入」這一步。
- **既有文件不動**：它們沒有 frontmatter，結構 lint 不掃它們，只由 `wiki/index.md` 連過去。

### 紀錄（JSONL 一行；向量不放 repo）
```json
{"id":"<ULID>","author":"bill.lin","host":"claude-code","product":"billing","repos":["104corp/104mis-billing-batch-aws"],
 "branch":"batch/sap-create-bu-data","type":"decision","title":"ErpDataRecordType 未知 type 改為不中斷",
 "body":"原因：多筆未知 type 要彙總 log，不能用單筆例外\n決定：fromValue 回傳 null；sapStatus 維持 WAIT_FOR_INSERT_MIDDLE_DB\n放棄：維持 throw 由 MainApp 逐筆 catch",
 "entities":[{"kind":"external","name":"SAP"}],
 "files":[{"repo":"104corp/104mis-billing-batch-aws","path":"src/main/java/.../ErpDataRecordType.java"}],
 "commits":[{"repo":"104corp/104mis-billing-batch-aws","sha":"<sha>"}],
 "supersedes":null,"content_hash":"sha256:<...>","created_at":"2026-09-04T09:12:00Z"}
```

### Wiki 頁面 frontmatter
```yaml
type: decision            # feature / decision / entity / repo / runbook / overview
title: ...
product: billing
status: active            # active / superseded
superseded_by: null
sources: [<record id>, ...]
code_refs: [{repo: 104corp/104mis-billing-batch-aws, paths: [...]}]
related: ["[[sap-create-bu-data]]"]
updated: 2026-09-04
```

### 本機 SQLite（`~/.dev-memory/memory.db`）
- `turn`：原始對話，**只留在本機**。主鍵是 `<host>:<session_id>:<line_no>`。
- `archive_cursor(path, byte_offset)`：記錄每個 transcript 讀到哪裡，Stop 時只處理新增的行。
- `record`：狀態是 `local`、`submitted` 或 `merged`。
- `page`：從 `origin/main` 建出來的 wiki 索引。
- `fts`（FTS5，`tokenize = "unicode61 tokenchars '_'"`，由 `core/tokenize.ts` 預先斷詞）：中文切成重疊 bigram，查詢時組成 bigram phrase（等於子字串比對）；識別字保留完整形式，另外依 camelCase、snake_case 拆開。已知限制：只查一個中文字時用 prefix，找不到出現在連續段最後一個字的單字。
- `vector(ref, kind, model, model_digest, dim, content_hash, embedding BLOB)`：只有 provider 是 `ollama` 才寫入；模型、digest 或內容變了就重算。
- `embed_queue(ref, kind, enqueued_at)`：待算向量的項目，在背景處理。

## 實作步驟

每個 Phase 做完先停下，給 diff 摘要，確認後才進下一個 Phase。工時是**粗估**，單人兼職會更久。

### Phase 0：建立專案與 Spike 驗證（2–3 天）
| 步驟 | 驗證 |
|---|---|
| 1. `git init`，確認 `docs/`、`AGENTS.md`、`CLAUDE.md` | 兩個工具開在這個目錄都讀得到指引 |
| 2. 做一個最小的 hello plugin（一個 skill、一個 SessionStart hook、一個 stdio MCP tool），兩份 manifest、兩份 marketplace | Claude Code 用 `claude --plugin-dir` 載入後三者都正常；Codex 用 `codex plugin marketplace add ./` 安裝、信任 hook 後三者都正常 |
| 3. 確認兩件事：`hooks/hooks.json` 能不能兩邊共用；Codex plugin 能不能帶 stdio MCP | 記下結果。不能共用就拆成兩份；Codex 帶不了 MCP 就改讓 skill 直接呼叫 shell CLI |
| 4. 確認 `bun:sqlite` 的 FTS5 在 macOS arm64 可用 | 能建立表、能查詢 |
| 5. 寫 `tokenize.ts`，用 claude-mem 的 observation 測（筆數會持續增加） | 中文詞 MATCH 筆數 = LIKE 筆數；`WAIT_FOR_INSERT_MIDDLE_DB` 找得到 |
| 6. 寫 `repo-id.ts` | ssh、https、worktree、Codex `session_meta` 四種來源都轉成同一個 ID |

**Phase 0 結果（2026-09-18）**：詳見 `docs/spikes/phase-0.md`。
- 0.1、0.4、0.5、0.6 通過。
- 0.2–0.3：
  - Claude Code 用 `claude plugin validate --strict` 通過。
  - Codex 在隔離環境確認能安裝，skill 跟 stdio MCP 都看得到。
  - hooks.json 共用的部分文件層面成立。
  - **待 Bill 在兩個工具的真實 session 裡驗證 hook 跟 MCP 呼叫**。
- `bun test` 32/32 通過。
- `例外` 實測 12 = LIKE 12（筆數比規劃時多，是因為 claude-mem 還在寫入）。

### Phase 1：本機蒐集與關鍵字搜尋（兩個工具都做，約 1.5–2 週）
| 步驟 | 驗證 |
|---|---|
| 1. `core/db.ts` schema 跟 migration（包含空的 `vector`、`embed_queue`）；`dev-memory init` 產生 config，`provider = "none"` | 刪掉 DB 能從頭重建；`none` 模式下搜尋只用關鍵字 |
| 2. `adapters/claude-code.ts`：過濾 `isMeta`、`tool_result`、`<task-notification>`、`<command-*>`、`<system-reminder>` | 用 fixture 跑 `bun test` 全過 |
| 3. `adapters/codex.ts`：從 `session_meta.git` 取 repo 跟 branch，從 `event_msg` 取 user/agent 訊息；略過 reasoning | 用 fixture 跑 `bun test` 全過 |
| 4. `core/git-files.ts`：session 開始的 commit 到 HEAD 的 diff，加上 working tree | Codex 用 `exec_command` 改的檔案也抓得到 |
| 5. hooks：Stop 增量存檔；SessionStart 補掃，並注入一段簡短指引（含搜尋模式狀態） | 兩個工具各跑一次 session，`turn` 表裡兩種 host 都有；強制結束 session 後，下次開啟會補回 |
| 6. `search.ts` + MCP `memory_search` / `memory_get` + CLI `dev-memory search` | 在 Codex 的 billing-api session，用 `scope=product` 找得到 Claude Code 在 billing-batch 記下的內容 |
| 7. `/mem-save` skill | 兩個工具都能用；存下來的紀錄是中文，有原因、決定、放棄的方案 |
| 8. 回填磁碟上現有的 Claude transcript 跟 Codex rollout | 匯入筆數跟檔案數對得上 |
| 9. 評測集 `eval/queries.yaml`（30 題，部分故意用跟紀錄不同的說法問）加上 `dev-memory eval` | 輸出「只用關鍵字」跟「AI 改寫查詢多試幾次」兩種的 Recall@5，當作 Phase 4 的基準線 |

**Phase 1 結果（2026-09-18）**：步驟 1–8 完成，`bun test` 77 pass / 0 fail。
- `core/{db,config,archive,search,record,git-files,eval}.ts`、`adapters/{claude-code,codex}.ts`、`hooks/{session-start,stop}.ts`、`cli.ts`、`mcp-server.ts`（SDK 打包成 `dist/mcp-server.js`）、`skills/mem-save`。
- 實測：552 份 transcript → 2,596 個 turn；Codex 105/105 有 repo ID。
- **查出兩個缺陷並修掉**：
  1. 查詢全部 AND 串起來 → 中文問句是一整個連續段，永遠對不上，Recall 0%。改成 `buildSearchQuery`（整段 phrase 加上各個 bigram 一起 OR），`buildMatchQuery` 保留精準子字串語意。
  2. `relevance()` 把 bm25 的正負號弄反，越差的結果排越前面。
- **基準線**：`eval/queries.example.yaml` 5 題，Recall@5 從 0% → 40%，MRR 0.267。語意型問題（「那個一直維持某個狀態的欄位叫什麼」）關鍵字搜尋本來就打不到，是 Phase 4 向量搜尋要解的。
- **步驟 9 待補**：正式的 30 題評測集要由記得那些決策的人來寫，我只附了 5 題範例跟 runner。

### Phase 2：Memory repo、提交、wiki ingest、本機審核頁（取代 n8n + Apps Script，約 2–2.5 週）
| 步驟 | 驗證 |
|---|---|
| 1. `templates/memory-repo`（`schema.md` 搬入 n8n 的 prompt、`repos.yaml`、`.gitattributes`、CI）+ `dev-memory init-repo`。**就地套用到既有的 `104mis-billing-doc`**，不另開 repo；先在 `xinqilin/dev-memory-test` 用假資料跑通 | 故意放一把假的 AWS key，CI 會擋下 PR；既有 39 份文件不被 lint 影響 |
| 2. `sync`：`git fetch` 後用 plumbing 指令讀 `origin/main`；把已 merge 的紀錄標成 `merged` | 隊友的 PR merge 後，本機 sync 就搜得到 |
| 3. `/wiki-ingest`：<br>a. 決定範圍<br>b. 從對話萃取候選紀錄，由作者確認<br>c. 第一步分析，只能從固定的幾種動作裡選，由作者確認<br>d. 第二步產生 wiki 頁<br>e. 檢查有沒有 secret 或個資，匯出 JSONL<br>f. 啟動本機審核頁（見步驟 4），交給作者 | 用 sap-create-bu-data 重跑一次，產出的 decision 頁要有原因跟決定；跟 n8n 產的版本 diff 比品質；兩個工具產出的結構一致 |
| 4. 本機審核頁 `dev-memory review`：<br>- 頁面清單<br>- 左右並排的編輯與預覽（沿用 `Page.html`）<br>- 跟 main 比較、來源紀錄、檢查結果<br>- 捨棄、核准並 commit<br>- token 驗證、自動存檔、用 SSE 同步外部修改 | ① 在頁面改完，檔案內容一致<br>② 在對話叫 AI 修改，頁面會自動重新載入<br>③ 兩邊同時改會跳出衝突提示，不會直接蓋掉<br>④ 沒帶 token 呼叫 API 會回 401<br>⑤ 檢查到假的 secret 時「核准」按鈕不能按<br>⑥ 斷網時預覽照常運作（不依賴 CDN）<br>⑦ markdown 裡的 `<script>` 不會執行 |
| 5. `publish`：`git push` + `gh pr create`，只能由使用者在審核頁按「送出 PR」或自己執行指令觸發 | PR 作者是使用者本人；完成後頁面顯示 PR 連結，伺服器自動關閉 |
| 6. 把 `104mis-billing-doc` 既有的 39 份文件登記進 `wiki/index.md`（原地不動、不搬檔、不改格式）；之後有頁面要被 `/wiki-lint` 檢查時再逐步補 frontmatter | `index.md` 同時涵蓋既有文件跟新產生的頁；既有文件的連結跟 commit 歷史都沒斷 |
| 7. 兩個作者同一個月各自提交 | `records/` 不會衝突 |

**Phase 2 結果（2026-09-18）**：步驟 1–7 完成，`bun test` 117 pass / 0 fail。
- `templates/memory-repo/`（schema.md、repos.yaml、`tools/lint.ts`、CI、index/log）＋ `init-repo`：就地套用、不覆蓋既有檔案。
- `core/{sync,worktree,export,index-docs,publish}.ts`、`review/{server,checks,ui}`、`skills/wiki-ingest`。
- 審核頁：只綁 `127.0.0.1`、隨機 port、每個請求驗 token、路徑鎖在 worktree 內、存檔比對 `base_hash`、外部修改走 SSE 通知；`marked`／`DOMPurify`／`diff` 打包成 88 KB 進 repo，不走 CDN。
- 紀錄匯出成 `records/<product>/<yyyy-mm>/<author>.jsonl`，只 append。**步驟 7 驗證**：兩個作者同一個月各自提交，branch 合併沒有衝突（測試會實際跑 `git merge`）。
- **要注意的坑**：plugin 更新是看版本號，不是內容。改完要 bump `plugin.json` 的 version，否則 `claude plugin update` 是空操作。
- 待實際跑一次：`/wiki-ingest` 的端對端流程（三個確認點）跟 `publish` 開真的 PR。

### Phase 3：跨 repo 知識與 Lint（約 1 週）
| 步驟 | 驗證 |
|---|---|
| 1. ingest 時維護 entity 頁 | 問某張資料表的讀寫方，能列出跨 repo 的結果 |
| 2. `/wiki-lint` 結構檢查 + 語意檢查 | 壞掉的連結、孤兒頁、互相矛盾的 decision 都抓得到 |
| 3. `code_refs` 過時偵測（透過 `gh api`） | 改了 `code_refs` 列出的檔案後，對應頁面被標為可能過時 |
| 4. **問答回填**（借自 llm_wiki 的 query 迴圈）：搜尋回答完之後，如果答案有保留價值，提議把它寫成一頁或補進既有頁；一樣要作者確認才寫入 | 問一個現有頁面答不完整的問題，回答後會提議建立或更新頁面；作者說不要就什麼都不寫 |
| 5. **來源檢查**（借自 llm_wiki 的 citation 驗證）：`/wiki-lint` 檢查每頁 frontmatter 的 `sources[]` 都指得到真實存在的紀錄，並抽查頁面內容是否真的來自那些紀錄 | 手動把某頁的 `sources[]` 改成不存在的 id，lint 要抓出來；憑空捏造、沒有來源的段落會被標示 |
| 6. 評測集擴充到 50 題，加入跨 repo 題目 | 跟 Phase 1 的基準線比較 |

**Phase 3 結果（2026-09-18）**：六個步驟完成，`bun test` 134 pass / 0 fail，plugin 0.2.0。
- `core/entities.ts`：從紀錄的 `entities[]` 加 `repos[]` 整理出「誰寫、誰讀」，並列出哪些 entity 還沒有頁面。只呈現紀錄裡寫的，不猜讀寫關係。
- `core/lint.ts` ＋ `/wiki-lint` skill：壞連結（`[[slug]]` 跟相對連結都查）、孤兒頁、`superseded_by` 指向、**`sources[]` 指得到真實紀錄**、同名 active 頁。語意矛盾交給 skill 的判斷半。
- `core/staleness.ts`：用 `gh api repos/{repo}/commits?path=&since=` 查 `code_refs` 的檔案有沒有在頁面更新後被改過。實測對 `xinqilin/dev-memory` 正確抓到 tokenize.ts（2 個 commit）跟 search.ts（3 個）。`gh` 不可用時回報略過，不猜。
- **問答回填**：SessionStart 注入的指引加一句，mem-save skill 加「Filing an answer back」段落。
- **來源檢查**：除了 id 存不存在，另外比對頁面標題跟來源紀錄有沒有共同用字，沒有就出警告（標明是提示、要人工確認）。
- **評測集**：`dev-memory eval --suggest` 從現有記憶生候選題目（標題當種子、識別字跟數字當判斷關鍵詞），但明講「query 要改寫成你自己的問法」——50 題的正式評測集仍然要人來寫。

### Phase 4：語意搜尋選配（Ollama + 使用者選模型，約 1 週）
| 步驟 | 驗證 |
|---|---|
| 1. `core/embedding/provider.ts` 介面 `embed(texts, kind: "query"\|"document")`、`info()`；實作 `none` 跟 `ollama`，查詢前綴依模型處理 | `bun test`：`none` 不打任何網路請求；`ollama` 用 mock server 測批次、`dimensions`、`keep_alive`、逾時降級 |
| 2. `embed_queue` 背景處理、`dev-memory embed --rebuild`、digest 檢查 | 換模型後重算完，`vector` 表只剩新模型的資料 |
| 3. `search.ts` 加 RRF 混合排序 | `none` 模式的結果跟 Phase 1 完全一樣 |
| 4. `/mem-setup` skill + `dev-memory setup`（互動與非互動兩種） | 在沒裝 Ollama 的機器上只列指令、不會自己安裝；使用者裝好後健康檢查通過 |
| 5. 在 Bill 的 M2 16GB 實測 `none`、`qwen3-embedding:0.6b`、`bge-m3`、`qwen3-embedding:4b`：下載大小、`ollama ps` 記憶體、冷啟動時間、每秒處理幾筆、Recall@5 / MRR | 產出 `docs/embedding-benchmark.md`，依結果修正 RAM 建議表跟預設建議；確認每個模型實際輸出 1024 維 |
| 6. 關掉 Ollama 服務後再搜尋 | 自動降級成只用關鍵字，並附提醒，不報錯 |

### Phase 5：團隊推廣（約 1 週，加上試用期）
| 步驟 | 驗證 |
|---|---|
| 1. README：<br>- 前置需求：bun、`gh auth login`、clone memory repo、`dev-memory init`<br>- 用 `/mem-setup` 選搜尋模式，附硬體建議表<br>- Claude Code 跟 Codex 的安裝方式（Codex 要加信任 hook 的步驟） | 兩個工具都能從私有 repo 安裝 |
| 2. 找 1–2 位隊友試用，至少一位主要用 Codex、一位選 `none` | 記錄安裝到第一個 PR merge 花多久（目標 30 分鐘內）、卡在哪裡 |
| 3. 退場舊工具（由 Bill 決定）：<br>- 停用 claude-mem（改 `settings.json` 前先讀 `governance/maintenance.md`）<br>- 停掉 n8n workflow 跟 Apps Script<br>- 移除 `skills/n8n-doc-sync` 跟 `sync-to-n8n.sh` | 不會同時有兩套系統在蒐集 |

### Phase 6：選配（有觸發條件才做）
| 選項 | 觸發條件 | 做法 |
|---|---|---|
| sqlite-vec | 向量超過約 10 萬筆（推測） | 需要 Homebrew 版 SQLite + `setCustomSQLite` |
| Bedrock embedding provider | 有人不能或不想在本機跑模型 | 多寫一個 provider（Cohere Embed v4）；每個使用者需要 AWS 權限 |
| 中央 RDS PG + pgvector + pg_bigm | 不用 CLI 的人（例如 PM）需要網頁搜尋 | 由 CI 從 memory repo 建索引 |
| ingest 改在 CI 集中執行 | 每週因為 wiki 衝突要 rebase 的 PR 超過 2–3 個 | 紀錄 merge 後由 Action 跑 ingest |

## 風險 / Gotchas
- **transcript 格式不是穩定介面**：兩個 adapter 都要用 fixture 測試、寬鬆解析；解析失敗只記 log，不能影響 session。
- **Codex 的 SessionEnd 最多 3 秒**：所以主要靠 Stop 增量存檔，加上 SessionStart 補掃。
- **Codex hook 要使用者手動信任**才會執行，也就才開始蒐集。
- **Codex 能不能帶本機 stdio MCP**：Phase 0 實測可以（只讀 `mcp.json`）。**能不能從私有 marketplace 安裝**：plugin repo 已推上 `xinqilin/dev-memory`（private），待實測。
- **plugin repo 會隨安裝散佈**：Codex 安裝時把整個 plugin 目錄複製到 `~/.codex/plugins/cache/`，Claude Code 會 clone 整個 marketplace repo。所以記憶、transcript、真實資料一律不能進 plugin repo；`.gitignore` 已擋 `*.jsonl`、`*.db`，Phase 1 加 fixture 時只開白名單給去敏感化過的檔案。
- **既有文件沒有 frontmatter**：`104mis-billing-doc` 那 39 份是人寫的 SOP 跟規格，結構 lint 只能掃 `wiki/` 與 `records/`，否則一開 CI 就全紅。
- **plugin 的 hook 跟 MCP 依賴 PATH 裡有 `bun`**：Agent Plugins 規格規定裸指令名稱由 client 決定怎麼找，README 要寫明；GUI 啟動的工具可能拿不到 shell 的 PATH。
- **repo ID 規則**：統一小寫並去掉 host（**Bill 已確認**）。代價是不同 host 上的同名 `owner/repo` 會被當成同一個；104corp 只用 GitHub，不受影響。
- **Skill 不能寫死工具專屬的 tool 名稱**。
- **Ollama 預設把模型留在記憶體 5 分鐘**：一律帶 `keep_alive: "30s"`。
- **Qwen3-Embedding 查詢沒加前綴會掉 1–5% 準確度**：provider 依模型處理。
- **換模型或模型更新後，舊向量不能沿用**：用 model + digest 判斷，自動重算。
- **plugin 不能自己偷偷裝軟體**：Ollama 跟模型一律要使用者同意。
- **Push 規則**：`publish` 一律由使用者自己執行。審核頁的「送出 PR」只能由使用者自己按，skill 要寫明 AI 不能呼叫 `/api/publish`。
- **審核頁的本機 API 可能被其他網頁或程式亂打**：只綁 `127.0.0.1`、port 隨機、每個 API 都驗 token。
- **審核頁、AI、IDE 可能同時改同一個檔**：存檔一律比對 `base_hash`，對不上就提示使用者，不會直接覆蓋。
- **markdown 預覽可能執行夾帶的 HTML**：先用 DOMPurify 清理再顯示。
- **本機審核頁不能在手機上看**：要用手機，只能等 PR 開出來後在 GitHub app 看。

## 決策（Bill 已確認）
1. **Memory repo**：沿用既有的 `104corp/104mis-billing-doc`，就地加 `wiki/`、`records/`、`schema.md`、`repos.yaml`、CI，**不另開**。
2. **範圍**：只放 billing 的記憶。crm、aisr 等其他產品要用時另開一份 memory repo，不 rename 現有的。
3. **測試資料**：測試期用假資料，放獨立的 `xinqilin/dev-memory-test`（private）；**絕不放進 plugin repo**，因為 plugin 會整包散佈給安裝的人。
4. **CI 範圍**：gitleaks 掃全 repo；結構 lint 只掃 `wiki/` 與 `records/`。
5. **repo ID**：`owner/repo`，統一小寫、去掉 host。
6. **MCP server**：用 `@modelcontextprotocol/sdk`，`bun build` 打包成單檔 commit 進 repo（git 來源的 marketplace 不會有 `node_modules`）。
7. **審核方式**：Phase 2 必做本機審核頁，不再用 Google Chat 加 Apps Script 連結。
8. **Runtime**：Bun。
9. **claude-mem 現有資料**：不匯入，只拿來當 tokenizer 的測試資料。
10. **預設搜尋模式**：`none`；Ollama 的模型選項先提供 qwen3-embedding 0.6b/4b/8b 跟 bge-m3；Bedrock 放在 Phase 6。

## 待確認
- 無。名稱已定案：plugin `dev-memory`、plugin repo `xinqilin/dev-memory`（未來搬 104corp）、marketplace `104mis-plugins`，安裝字串 `dev-memory@104mis-plugins`。marketplace 名稱刻意用團隊前綴，搬家後不用再改、也不用重裝第二次。

## 前置需求（Bill 提供）
- n8n workflow export JSON（`schema.md` 要沿用它的 prompt 跟 category/slug 規則）
- billing 底下要納入的 code repo 清單（填進 `repos.yaml`）

## Sources
- Karpathy LLM Wiki gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- nashsu/llm_wiki: https://github.com/nashsu/llm_wiki
- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Codex plugins: https://developers.openai.com/codex/plugins/build
- Codex hooks: https://learn.chatgpt.com/docs/hooks
- Ollama API (/api/embed): https://github.com/ollama/ollama/blob/main/docs/api.md
- Ollama qwen3-embedding: https://ollama.com/library/qwen3-embedding
- Qwen3-Embedding-0.6B: https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
- BAAI/bge-m3: https://huggingface.co/BAAI/bge-m3
- Bun SQLite: https://github.com/oven-sh/bun/blob/main/docs/runtime/sqlite.mdx
- RDS PostgreSQL extensions: https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html
- PGlite extensions: https://pglite.dev/extensions/
- Chroma default embedding: https://www.c-sharpcorner.com/article/understanding-the-default-embedding-mechanism-of-chromadb
