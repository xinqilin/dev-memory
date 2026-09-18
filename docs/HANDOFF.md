# Handoff — 2026-09-18（Phase 3 完成）

## Goal

把 Bill 個人的文件流程（claude-mem → `/n8n-doc-sync` → n8n → Google Chat → Apps Script → PR）做成團隊可以安裝的 plugin `dev-memory`，需求如下：
- 同時支援 Claude Code 與 Codex CLI
- 開發記憶長期保存、可以跨 repo 搜尋
- 由 LLM 維護 wiki，wiki 就是文件
- 用 PR 提交，分享給全隊

## Current Status

- **Phase 3 完成（2026-09-18）**：entity 索引、`lint`、`stale`、問答回填、來源檢查、`eval --suggest` 都做好了，`bun test` 134 pass / 0 fail，plugin **0.2.0**。
  - 一次完整 ingest 已經實跑過：存紀錄 → wiki 頁 → 審核頁 → PR → merge → `sync`，搜尋排序是 wiki 頁 > 紀錄 > 對話。
  - 實跑抓到 4 個 bug：靜態資源被 token 擋住、新資料夾被當成一個項目列出、核准檢查把 wiki 規則套到 records/repos.yaml、失敗訊息只在小字。都已修並補測試。
- **Phase 2 步驟 1–7 完成（2026-09-18）**：memory repo 模板、sync、ingest worktree、審核頁、publish、紀錄匯出都做好了，`bun test` 117 pass / 0 fail。
  - plugin 版本升到 **0.1.0**（更新是看版本號，不 bump 的話 `claude plugin update` 不會拉新版）。
  - 測試 repo `xinqilin/dev-memory-test` 已建好並套用骨架。
  - 還沒實際跑過一次完整 ingest（三個確認點 → 開真的 PR）。
- **Phase 1 步驟 1–8 完成（2026-09-18）**：可以蒐集、建索引、中文搜尋、存紀錄，MCP 跟兩個 hook 都接上了。`bun test` 77 pass / 0 fail。
  - plugin repo 已推上 `xinqilin/dev-memory`（private），Claude Code 從私有 marketplace 安裝、hook、skill、MCP 四項都實測過。
  - Codex 端還沒實測（使用者說之後再修）。
  - 步驟 9 的 30 題評測集待補：目前只有 5 題範例，基準線 Recall@5 40%、MRR 0.267。
- **Phase 0 完成**，結果在 `docs/spikes/phase-0.md`。
  - git repo：branch `master`，共 4 個 commit（初始化、hello plugin、核心 spike、Phase 0 文件），**沒有 push、沒有 remote**。
  - 0.1、0.4、0.5、0.6 實測通過；`bun test` 32/32 通過。
  - 0.2–0.3：Claude Code 的 `claude plugin validate --strict` 通過；Codex 在隔離的 `CODEX_HOME` 實測能安裝，skill 跟 stdio MCP 都看得到。**還沒在兩個工具的真實 session 裡驗證 hook 輸出跟 MCP 呼叫**，要 Bill 照 spike 文件最後一節自己跑。
- 完整計畫在 `docs/PLAN.md`（已同步 Phase 0 結果），原檔是 `~/.claude/plans/claude-mem-luminous-naur.md`。
- 圖解在 `docs/eli5.html`（一份就夠，原本的比喻版跟流程版已合併；瀏覽器直接開檔，不再放 claude.ai）。
- `PLAN.md` 最後有「待確認決策」，另外 `docs/spikes/phase-0.md` 有 3 項「需要你決定」。

## 討論過程（決策怎麼演變）

1. **盤點現況**：讀過 `sync-to-n8n.sh`、`n8n-doc-sync/SKILL.md`、Apps Script 的三個檔案，發現：
   - 撈資料只用 `project = ? AND title LIKE ?`，從來沒用到向量搜尋。
   - Apps Script 用一把共用 PAT，所以 PR 作者身分都是 Bill，而且 repo 名稱寫死。
2. **初版建議**：不自建 PG + pgvector，改用 transcript + git，拿掉 n8n 跟 Apps Script。
3. **Bill 反駁**：transcript 14 天後會被刪；只存檔案的話，一年 365 份沒人整理。→ 同意長期記憶要放 DB。
4. **同事問「中文怎麼切字詞」**：釐清兩件不同的事：
   - 斷詞是給關鍵字搜尋用的，中文採 bigram（兩字一塊）。
   - 切塊是給向量搜尋用的，一筆紀錄就是一塊。
   - 搜尋採混合搜尋，準不準用評測集來量。
5. **Bill：DB 不用共用**，每個人在本機跑，只要把記憶提交上來。→ 決定提交 JSONL 紀錄，不提交 DB 檔；repo 是正本，本機 DB 只是索引。
6. **參考 nashsu/llm_wiki 跟 Karpathy 的 LLM Wiki**：在紀錄上面加一層由 LLM 維護的 wiki（就是文件），採兩步 ingest、lint、`index.md` 導航。
7. **新需求：跨 repo 記憶**：
   - repo ID 正規化
   - `repos.yaml` 做產品分組
   - 為資料表、API 建 entity 頁
   - 用 `code_refs` 偵測文件過時
8. **新需求：Claude Code 跟 Codex 共用同一個 plugin**：查過官方文件，確定可行；資料固定放 `~/.dev-memory/`。
9. **最後釐清的幾件事**：
   - SQLite 就夠用。
   - 不需要 PAT，用 `gh auth login` 或 SSH 登入即可。
   - 本機可以裝 PG 或 Ollama，但先不裝。
   - 向量搜尋改成「評測不達標才加」，加之前先在 M2 16GB 上實測資源用量。
10. **Bill：要讓使用者自己選要不要裝 Ollama、用哪個模型** → 新增 `/mem-setup`，放在 Phase 4 實作。
11. **Bill：要保留 Apps Script 那種即時修改＋預覽** → 改做本機審核頁，Phase 2 必做。功能比 Apps Script 多：一次看多頁、跟 main 比較、看來源紀錄、AI 修改會同步到頁面。

## What Didn't Work（被否決的方案）

- **自建 PG + pgvector 當核心**：一人一年約一萬筆（推測）；每個人本機要多跑一個服務；pg_bigm 要自己編譯；共用已經靠 git，PG 的強項用不到。
- **沿用 claude-mem 當素材來源**：
  - FTS5 預設 tokenizer 不斷中文：`MATCH '例外'` 只找到 1 筆，`LIKE` 找到 10 筆。
  - #3727 用英文摘要，漏掉了決策（`sapStatus` 維持 `WAIT_FOR_INSERT_MIDDLE_DB`）。
  - `project` 用目錄名稱，換機器或跨 repo 就對不上。
- **直接提交 DB 檔**：二進位檔無法 review，也無法 merge；向量跟 embedding 模型綁死。
- **只存 archive 檔案、不建 DB**（初版建議）：一年下來資料沒有結構，無法整理。
- **transcript 只用單一 branch 過濾**：同一個功能分散在 `batch/sap-create-bu-data`（106 筆）和 `review/sap-create-bu-data`（325 筆）兩個 branch。
- **WebSearch 摘要說 RDS 支援 zhparser/pg_jieba**：查 AWS 官方清單後是錯的，實際只支援 pg_bigm、pg_trgm、pgvector 0.8.2。
- **另開 memory repo 再把 `104mis-billing-doc` 匯入**（2026-09-18 改掉）：當初的理由是「舊流程還在往那個 repo 開 PR，兩套系統會打架」，但 n8n 跟 Apps Script 已經停用，理由不成立。改成就地沿用：既有文件的 commit 歷史跟連結都留著，也省掉匯入那一步。
- **把測試用的記憶放進 plugin repo**：不行。Codex 安裝時會把整個 plugin 目錄複製到 cache，Claude Code 會 clone 整個 marketplace repo，等於把資料發給每個安裝的人。測試記憶要獨立一份 repo。

## Key Decisions Made

- **三個 repo 的角色（2026-09-18 定案）**：
  - `xinqilin/dev-memory`（private，**已建並 push**）：plugin 原始碼＋marketplace。會隨安裝散佈給每個人，所以**任何記憶或真實資料都不能放**。
  - `xinqilin/dev-memory-test`（已建，private，骨架已套用）：測試期的假資料 memory repo。
  - `104corp/104mis-billing-doc`（既有）：正式 memory repo，**沿用不另開**，只放 billing。
- **正本**：放在 memory repo，就地加在既有文件旁邊。
  - `records/<product>/<yyyy-mm>/<author>.jsonl`：只新增不修改，一人一月一檔
  - `wiki/`：LLM 維護的文件，`wiki/index.md` 同時連到既有的 39 份文件
  - `schema.md`：規則，取代原本放在 n8n 裡的 prompt
  - `repos.yaml`：產品跟 repo 的對應（目前只有 billing）
  - `.gitattributes`：`records/** linguist-generated=true`，讓 GitHub 摺疊 JSONL 的 diff
  - CI：gitleaks 掃全 repo；結構 lint 只掃 `wiki/` 與 `records/`，既有文件沒有 frontmatter，不納入
- **本機**：`~/.dev-memory/memory.db`（SQLite），只是索引，隨時可以重建；原始對話只留在本機，不提交。
- **不用**：claude-mem、n8n、Apps Script；本機不用 PostgreSQL。
- **搜尋**：
  - FTS5，中文轉 bigram，識別字依 camelCase/snake_case 拆開
  - AI 會自己改寫查詢多試幾次
  - 先讀 wiki 的 `index.md` 導航
- **語意搜尋由使用者自己選**：透過 `/mem-setup` 選擇，預設 `none`（只用關鍵字）。
  - 選 Ollama 時可挑 qwen3-embedding 0.6b/4b/8b 或 bge-m3。
  - plugin 不會自己安裝軟體，要使用者同意。
  - 向量一律存在 SQLite、統一 1024 維，不放進 repo，所以每個人可以選不同模型。
  - 放在 Phase 4 實作並實測；團隊推廣順延到 Phase 5，中央 PG 等選配項目改為 Phase 6。
- **不用 Chroma**：它只負責存向量、找相近向量，SQLite 就做得到。它預設的 all-MiniLM-L6-v2 是英文模型，而且要另外開一個 Python 程序。
- **本機審核頁（Bill 已確認要做，取代 Apps Script）**：
  - **流程**：`/wiki-ingest` 有三個確認點（候選紀錄 → 整理計畫 → 審核頁），**不會直接開 PR**；使用者自己按「送出 PR」才會 push。
  - **頁面**：左右並排的編輯＋預覽沿用 `~/Desktop/appscript/Page.html`，另外加頁面清單、跟 main 比較、來源紀錄、檢查結果。
  - **技術**：
    - 伺服器用 `Bun.serve`，只綁 `127.0.0.1`，隨機 port，所有 API 都要驗 token。
    - 自動存檔，存檔時比對 `base_hash`；外部修改用 SSE 通知頁面。
    - `marked`、`diff`、`dompurify` 打包進 plugin，不走 CDN。
  - **限制**：沒辦法用手機審核，只能等 PR 開出來後在 GitHub app 看。
- **LLM**：直接用 Claude Code 或 Codex 本身，不需要額外的 API key。
- **push 跟開 PR 由使用者自己執行**：Bill 的 CLAUDE.md 禁止 agent 執行 git push。
- **認證**：`gh auth login` 或 SSH，不需要 PAT；CI 用內建的 `GITHUB_TOKEN`。
- **Runtime**：Bun + `bun:sqlite`。macOS 上 Bun 用的是**系統** SQLite，不是 Bun 自帶的；Phase 0 實測 macOS arm64 是 3.51.0，有開 FTS5。「Bun build flag 有開 FTS5」只適用 Linux/Windows。
- **FTS5 斷詞（Phase 0 實測通過）**：`unicode61 tokenchars '_'`，由 `core/tokenize.ts` 預先斷詞（中文 bigram、識別字完整形式加上拆開的部分），查詢時組成 bigram phrase。
- **repo ID（已確認）**：`owner/repo`，統一小寫並去掉 host。
- **MCP server（已確認）**：Phase 1 改用 `@modelcontextprotocol/sdk`，`bun build` 打包成單檔 commit 進 repo。Phase 0 的零依賴版本只是 spike。
- **plugin 檔案配置（Phase 0 實測）**：
  - Claude Code 讀 `.claude-plugin/plugin.json`、`.mcp.json`。
  - Codex 讀根目錄 `plugin.json`（Agent Plugins 1.0.0）、`mcp.json`，**不讀** `.mcp.json`。
  - `hooks/hooks.json` 共用一份。
  - 三個指引檔被全域 gitignore 擋住，已在 repo `.gitignore` 加 `!` 例外。
- **兩個工具共用**：
  - manifest 跟 MCP 設定各一份
  - skills 共用，內容不寫死任何工具專屬的 tool 名稱
  - 主要靠 Stop hook 增量存檔
- **名稱（2026-09-18 定案）**：plugin `dev-memory`；plugin repo `xinqilin/dev-memory`；marketplace `104mis-plugins`（原本叫 `project-plugin`，沒有鑑別度）。安裝字串是 `dev-memory@104mis-plugins`。用團隊前綴是為了搬到 104corp 後不用再改名、隊友也不用重裝第二次。
- **不匯入 claude-mem 現有的 observation**，只拿來當 tokenizer 的測試資料。
- **借自 llm_wiki 的兩件事加進 Phase 3（2026-09-18 決定）**：
  - **問答回填**：搜尋回答完後，有保留價值的答案提議寫成頁面（原作的 query 迴圈，我們原本只有「決策 → 紀錄」）。
  - **來源檢查**：lint 驗證 `sources[]` 指得到真實紀錄，並抽查內容是否真的來自那些來源（原作用 `[@source]` 做確定性驗證）。
  - 沒採用的第三項是 cascade 刪除：我們的 records 只新增不刪，語意對不上。

## Next Steps

1. **Bill 跑工具內驗證**（`docs/spikes/phase-0.md` 最後一節，有指令跟預期輸出）：
   - Claude Code：`claude --plugin-dir ./plugins/dev-memory`
   - Codex：`codex plugin marketplace add ./` → `codex plugin add dev-memory@104mis-plugins` → 信任 hook → 重開 session
   - 重點看 Codex 的 hook 有沒有輸出 `DEV_MEMORY_HOOK_OK host=codex`。沒有的話，照 spike 文件的退路把 hooks 拆成兩份。
2. 順便驗私有 marketplace 安裝（repo 已經 push 上去了）：
   ```bash
   claude plugin marketplace add git@github.com:xinqilin/dev-memory.git
   claude plugin install dev-memory@104mis-plugins
   ```
3. Bill 提供：
   - n8n workflow 的 export JSON（`schema.md` 要沿用它的 prompt 跟 category/slug 規則）
   - billing 底下要納入 `repos.yaml` 的 code repo 清單
4. Phase 4 之後：語意搜尋（Ollama）、團隊推廣。
5. Phase 1 剩下的：
   - 在 Codex 上實測 hook、skill、MCP（使用者說之後再修）
   - 補 `eval/queries.yaml` 的 30 題（要由記得那些決策的人寫，目前只有 5 題範例）
   - 使用者自己跑一次 `bun src/cli.ts init` 跟 `sweep`，把既有對話灌進 `~/.dev-memory`
5. 之後進 Phase 2：memory repo 就地套用到 `104mis-billing-doc`，先在 `xinqilin/dev-memory-test` 用假資料跑通。

## Critical Files

- `docs/PLAN.md`：完整規劃，包含架構、相容性表、資料格式、Phase 0–6 步驟與驗證方式。
- `docs/spikes/phase-0.md`：Phase 0 的結論、實測數據、要改計畫的地方、待 Bill 執行的工具內驗證清單。
- `plugins/dev-memory/src/core/{tokenize,repo-id}.ts`：Phase 1 會直接沿用的核心模組。
- `plugins/dev-memory/test/tokenize.claude-mem.test.ts`：用唯讀方式讀 claude-mem.db 的整合測試，沒有 DB 時自動 skip。
- `docs/eli5.html`：圖解（安裝、七個步驟、哪一步在哪裡做、會用到的東西、目前進度）。
- `~/.claude-mem/scripts/sync-to-n8n.sh`：現行撈資料的邏輯，是要取代的對象。
- `~/.claude/skills/n8n-doc-sync/SKILL.md`：現行 skill。`--feature` 跟 `maintenance/` 路徑的語意要保留；注意 `~/.claude` 有未 commit 的修改。
- `~/Desktop/appscript/appScript.gs`：現行的審核跟開 PR 流程；為什麼不開 Draft PR 寫在 483–488 行。
- `~/.claude-mem/claude-mem.db`：tokenizer spike 的測試資料（唯讀使用）。
- `~/.claude/projects/-Users-bill-lin-project-backend-104mis-billing-batch-aws/*.jsonl`：Claude transcript fixture 的來源。
- `~/.codex/sessions/**/rollout-*.jsonl`：Codex rollout fixture 的來源。

## Gotchas Found This Session

- **本次討論也會被刪**：Bill 的 `cleanupPeriodDays` 設 14，這次討論的 transcript 大約 2026-10-01 就會被刪，只能靠這份檔案保存。
- **Claude transcript 的行類型比想像多**（Phase 1 實測）：除了 `user`/`assistant`，還有 `attachment`（數量最多）、`mode`、`permission-mode`、`ai-title`、`last-prompt`、`atis-latch`，全都要濾掉。
- **subagent 不是放在 `subagents/` 目錄**：同一個檔案裡用 `isSidechain: true` 標記。
- **user 行要過濾**：`isMeta`、`tool_result`、`<task-notification>`、`<command-*>`、`<local-command-std*>`、`[Request interrupted`；`<system-reminder>` 區塊要剝掉但保留使用者自己打的字。
- **Codex 的對話會重複兩次**：`event_msg.user_message`／`agent_message` 一次，`response_item.message` 又一次。以 `event_msg` 為準，`response_item` 只在該 role 沒有 `event_msg` 時補。
- **中文問句是一整個連續段**：bigram phrase 等於精準子字串比對，拿來搜自然語言問句 Recall 是 0%。搜尋要用寬鬆版（整段 phrase 加各個 bigram 一起 OR），精準版留給需要子字串語意的地方。
- **SQLite 的 bm25 是負數**，越負越相關。換算成分數時弄反過就會整個排序顛倒（這個 bug 被評測集抓到）。
- **Bun 有 `TOML.parse` 但沒有 `stringify`**（1.3.4），寫設定檔要用模板。`Bun.YAML.parse` 則是可用的。
- **sandbox 下 `bun add` 要指定 `BUN_INSTALL_CACHE_DIR` 跟 `TMPDIR`**，否則會報 tempdir PermissionDenied。
- **sandbox 擋住監聽 port**：`Bun.serve` 會回報成 EADDRINUSE，審核頁的測試要在 sandbox 外跑。
- **plugin 更新看版本號**：改完內容要 bump `plugin.json` 跟 `.claude-plugin/plugin.json` 的 version，否則 `claude plugin update` 印 "already at the latest version"。
- **`git show` 的輸出不能 trim**：會吃掉檔案結尾的換行，還原檔案時就對不上原內容。
- **clone 空 repo 後 branch 是本機預設**（這台是 `master`），要 `git branch -m master main` 才推得上 `main`。
- **Codex rollout 的結構**：
  - `session_meta.git` 有 `repository_url`、`branch`、`commit_hash`
  - 改檔常常是透過 `exec_command`，所以要用 git diff 判斷改了哪些檔案
  - `transcript_path` 可能是 null，官方也標示格式不穩定
- **SessionEnd 時間很短**：Claude Code 預設 1.5 秒；Codex 預設 1 秒、最多 3 秒 → 主要靠 Stop hook 增量存檔。
- **Codex 的 hook 要使用者手動信任**才會執行。
- **Codex 的資料目錄不一樣**：它的 `PLUGIN_DATA` 跟 Claude 的不同，所以資料固定放 `~/.dev-memory/`。
- **macOS 系統 SQLite 不能載入 extension**：要用 sqlite-vec，得裝 Homebrew SQLite，再呼叫 `Database.setCustomSQLite`。
- **PG 系列的 extension 支援**：PGlite 沒有 pg_bigm；Homebrew 也沒有 pg_bigm；RDS 16/17 有 pg_bigm。
- **Claude Code 私有 marketplace 的背景自動更新**：HTTPS 的 credential helper 會被停用，SSH 可以用。
- **FTS5 unicode61 會把 `_` 當分隔符**，識別字要另外保留完整形式。
- **Bill 的機器**：MacBook Pro M2 16GB，還沒裝 Ollama。
- **全域 gitignore 會擋掉指引檔**：`~/.gitignore_global` 忽略 `CLAUDE.md`、`AGENTS.md`、`HANDOFF.md`、`.claude/`，所以 repo `.gitignore` 要加 `!` 例外。
- **Codex 安裝 plugin 會複製到 cache**：`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`，所以 plugin root 是複本。
- **Codex 的 `mcp.json` 規則**：`command` 不展開變數，只有 `args`、`env`、`cwd` 展開 `${PLUGIN_ROOT}`；`bun` 要在 PATH 裡。
- **Codex 驗證可以不碰 `~/.codex`**：用 `CODEX_HOME=$TMPDIR/codex-home`，就能在隔離環境跑 `codex plugin marketplace add`、`plugin add`、`mcp list`、`debug prompt-input`。但 `debug prompt-input` 不會觸發 SessionStart hook。
- **claude-mem 筆數會持續增加**：它還在記錄（包括開發 dev-memory 的 session），測試要斷言 MATCH = LIKE，不能寫死筆數。
- **Sandbox 擋寫 `.mcp.json`**：用 shell heredoc 寫會被拒，要改用檔案編輯工具。
- **Ollama 預設會把模型留在記憶體 5 分鐘**：請求要帶 `keep_alive: "30s"`。`/api/embed` 支援批次跟 `dimensions`，回傳的向量已經 L2 正規化。
- **Qwen3-Embedding 查詢要加前綴**（`Instruct: {task}\nQuery: {query}`），不加會掉 1–5%；文件本身不用加。bge-m3 不需要前綴。
- **claude-mem 的 Chroma 現況**：1.0GB、58,073 筆向量、384 維，collection 設定是 `{}`，也就是用 Chroma 預設的英文模型。

## 在其他地方接手

- **這個目錄**：`AGENTS.md` 會指向本檔跟 `PLAN.md`，Claude Code 透過 `CLAUDE.md` 的 `@AGENTS.md` 會自動讀到。
- **原始對話**：`cd ~/.claude && claude --resume ecdd633f-1cf1-4e5c-9fb1-483d5916be0f`，14 天內有效。

## Active Skill

無。Phase 0 已完成，等 Bill 跑完工具內驗證、確認決策後才進 Phase 1。
