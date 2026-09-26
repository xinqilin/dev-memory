# Handoff — 2026-09-18（Phase 3 完成）

## Goal

把 Bill 個人的文件流程（claude-mem → `/n8n-doc-sync` → n8n → Google Chat → Apps Script → PR）做成團隊可以安裝的 plugin `dev-memory`，需求如下：
- 同時支援 Claude Code 與 Codex CLI
- 開發記憶長期保存、可以跨 repo 搜尋
- 由 LLM 維護 wiki，wiki 就是文件
- 用 PR 提交，分享給全隊

## Current Status

- **onboarding 補上（2026-09-18，0.3.0）**：裝完 plugin 還要手動編 `config.toml` 是最容易卡住的一步，改成一個 `dev-memory setup`：寫設定、建索引、sweep、sync，並逐項檢查 bun/git/gh/FTS5/repo 結構，缺什麼就印出要跑哪一行。另外加 `mem-setup` skill。
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
   - 斷詞是給關鍵字搜尋用的，中文採 bigram（兩字一塊）＋ unigram（單字），兩塊分開不交錯。
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
  - FTS5，中文轉 bigram ＋ unigram，識別字依 camelCase/snake_case 拆開
  - AI 會自己改寫查詢多試幾次
  - 先讀 wiki 的 `index.md` 導航
- **v1 不做語意搜尋（2026-09-18 決定）**：第一版只有關鍵字搜尋，隊友不用裝 Ollama。關鍵字已經夠用（中文逐字全中、問句 Recall@5 40%），而多跑一個本機模型服務會直接墊高導入門檻。schema 的 `vector`、`embed_queue` 表先留著，要加的時候不用動其他部分。
- **這不是「知識蒸餾」**：知識蒸餾是拿大模型輸出訓練小模型做壓縮（teacher/student），我們一個模型都沒訓練。我們做的是自動化的團隊知識管理：開發過程自動留痕 → LLM 整理成 wiki → PR review 把關。
- **語意搜尋由使用者自己選**（Phase 4 之後）：透過 `/mem-setup` 選擇，預設 `none`（只用關鍵字）。
  - 選 Ollama 時可挑 qwen3-embedding 0.6b/4b/8b 或 bge-m3。
  - plugin 不會自己安裝軟體，要使用者同意。
  - 向量一律存在 SQLite、統一 1024 維，不放進 repo，所以每個人可以選不同模型。
  - 放在 Phase 4 實作並實測；團隊推廣順延到 Phase 5，中央 PG 等選配項目改為 Phase 6。
  - **2026-09-26 改**：Phase 4 改成「產品化」，語意搜尋移到 Phase 6 選配（觸發條件：30 題評測集顯示關鍵字不夠）。
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
- **FTS5 斷詞（Phase 0 實測通過）**：`unicode61 tokenchars '_'`，由 `core/tokenize.ts` 預先斷詞（中文 bigram 後接 unigram、識別字完整形式加上拆開的部分），查詢時組成 bigram phrase。
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
- **`parseArgs` 不支援 `--no-x`**：Node 的 parseArgs 沒有否定旗標，寫 `--no-sweep` 會直接丟 ERR_PARSE_ARGS_UNKNOWN_OPTION。改用 `--skip-*`。
- **`claude plugin` 沒有 `path` 子指令**：可用的是 details/list/install/update 等等，要拿安裝路徑只能用 cache 的萬用字元展開。
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

## 2026-09-21：中文單字查詢改成 unigram ＋ bigram

- **原因**：只存 bigram 時，一段中文的最後一個字永遠不是任何 token 的開頭，單字查詢用前綴比對抓不到。真實索引上查「表」漏了 82 筆（中介表、排程表、資料表）。
- **決定**：`tokenizeForIndex` 在 bigram 之後**另接一塊** unigram。schema v3 的 migration 從 `turn`／`record`／`page` 的原文重建 `fts`，本機 0.9 秒。
- **放棄**：(1) 交錯吐 unigram 與 bigram——會破壞 phrase 的相鄰性，最準的那一項查詢失效。(2) 直接採用外部範例程式——會失去 camelCase／snake_case 拆分。
- **量測**：評測集 Recall@5 維持 100%，MRR 0.590 → 0.750（只有 5 題，只能說沒變差）。索引 19.6 → 27.4 MB。


## 2026-09-22：lint 與 index-docs 的文件／實作漂移，0.6.0

### Goal

把「重寫 `core/lint.ts` 為文件版面」之後留下的漂移清乾淨，並補上 `docs/eli5.html`／`eli5-simple.html`
對「為什麼沒有套 embedding model」的說法（Bill 要拿去報告，會被同事追問）。

### Current Status

- plugin **0.6.0**，`bun test` **160 pass / 0 fail**。
- 三個 commit：`d9b2047`（lint）、`992f463`（0.6.0 / index-docs）、`34c9804`（eli5）。
- **三個 commit 都已推上 `origin/master`**（`34c9804`，ahead/behind 0 0）。剩下的只有本檔這次的改動。

### What Was Done This Session

- **lint 補回兩個檢查**（`src/core/lint.ts` 與 `templates/memory-repo/tools/lint.ts` 各一份）：
  重複標題（warning）、`supersedes` 必須指到存在的紀錄（error）。plugin 端接受只存在於本機索引的目標，CI 端看不到索引。
- **重寫 `skills/wiki-lint/SKILL.md`**：改成逐條列出 lint 真正做的 7 項檢查，並寫明「取代關係掛在紀錄上，不是文件上」。
- **修好 `index-docs`**：原本寫 `wiki/index.md`（版面已經沒有這個路徑）而且**沒有任何測試**。
  改成附加到 `README.md` 的「## 既有的人工文件」一節，只列 README 還沒連到的檔案 →
  它因此變成 lint「文件沒被索引到」那個錯誤的解法。排除 `records/`、`node_modules/`、`tools/`、
  `.github/`、`README.md`、`schema.md`、`CLAUDE.md`、`AGENTS.md`。
- 新增 `test/index-docs.test.ts`（6 個：只列未索引、無 H1 退回檔名、跑兩次不變、檔案刪掉會離開清單、
  後續段落不被吃掉）；刪掉 `test/export.test.ts` 裡驗舊行為的那個測試。
- 拿 `104mis-billing-doc` 的**副本**實跑（沒動正本）：18 份補進 README、19 份原本就索引到了。
- **eli5 兩份都補上「為什麼沒有用 embedding 模型」**：六個理由依強度排序 + 誠實的反面 + 報告用的一句話。

### What Didn't Work

- 第一次跑 `index-docs` 把 `CLAUDE.md` 也列進文件清單——那是給 agent 的指示不是文件，已加進排除清單（含子目錄）。

### Key Decisions Made

- **兩個 linter 不是同一份規則，而且誰都不能 import 誰**（plugin 端有索引、CI 端沒有）。
  `DOC_DIRS` 的重複是刻意的，兩邊註解都寫明了，不要再嘗試合併。
- **eli5 不改原本那張「現在為什麼不需要 Ollama」的表**，新增的是「被追問時怎麼答」，兩者用途不同。
- eli5 裡的數字一律沿用本專案量過的（341→423、重建 0.9 秒），沒有編新數字。

### Next Steps

1. `claude plugin update dev-memory` 拉 0.6.0（程式碼已在 remote 上）。
   （**沒 bump 版本號 `plugin update` 會是 no-op**，之前被這個坑過一次，舊版 `sync` 清掉了本機索引。）
2. **等 Bill 正式測試第二次** → `/dev-memory:wiki-ingest 主題是 sap-create-bu-data`。
   前兩次都是測試、產物已丟棄；**這次要真的送 PR**，寫成 `spec/batch/sap-create-bu-data.md`。
   素材位置：`104mis-billing-batch-aws` 的 **branch `batch/sap-create-bu-data`**（一支批次一個 branch，
   只能用 `git show <branch>:<path>` 讀，不得 checkout）；cron 在 `config/batch-schedule.md`。
3. 補 `spec/testing-point-to-erp.md` 兩個已知錯誤（該檔已 merge）：
   (a) `globalTransactionManager` 是 `ChainedTransactionManager`，**不是原子的**（反序 commit，可能部分成功）；
   (b)「失敗: M」的計數**不含** `markFail` 的紀錄。
4. Codex 端的 hook／安裝仍未實測——這是唯一還沒驗證的相容性宣稱。
5. 之後把 `104mis-billing-doc-test` 換成正式的 `104mis-billing-doc`。

### Critical Files

- `plugins/dev-memory/src/core/index-docs.ts` — 這次重寫，是 lint「未索引」錯誤的配套解法。
- `plugins/dev-memory/src/core/lint.ts` 與 `templates/memory-repo/tools/lint.ts` — 刻意重複的兩份規則。
- `plugins/dev-memory/skills/wiki-ingest/SKILL.md` — 下一步 `sap-create-bu-data` 會照這個流程跑。
- `docs/eli5.html`、`docs/eli5-simple.html` — 要拿去報告，改動前先問。

### Gotchas Found This Session

- **沒有測試的程式，改版面時會被靜默留在原地。** `index-docs` 指向一個不存在的路徑很久都沒人發現，
  因為它一個測試都沒有。這次漂移的兩個 commit 是同一個根因：重寫之後沒有回頭檢查誰還在用舊假設。
- **`git rev-parse --short HEAD origin/master` 一定會失敗**：`--short` 只接受單一 revision，
  兩個就報 `fatal: Needed a single revision`。這個訊息看起來像「ref 不存在」，其實無關——
  這次就是照字面解讀，誤判成三個 commit 沒推上去。查推送狀態用
  `git rev-list --left-right --count origin/master...HEAD`，空的 `git log origin/master..HEAD` 就代表推完了。

### Active Skill

無。等 Bill 下 `/dev-memory:wiki-ingest`（主題 `sap-create-bu-data`）才進下一段。

### 0.6.1：卡片不會再悄悄消失（2026-09-22，已修，未 commit）

- **捨棄時卡片退回本機**：新增 `ingest-discard --branch <b>`（`worktree.ts` 的 `discardIngest()`）：
  把這次匯出的卡片從 `submitted` 退回 `local`，再刪工作區跟本機分支。工作區被手動刪掉也行，會從分支重建再算。
  **已 push 的分支拒絕**：卡片在那個 PR 裡，退回會被匯出第二次，舊 PR 之後被 merge 就會出現重複 id。
  審核頁在卡片檔上按「捨棄這頁」也會退回（`server.ts` 的 `/api/discard`）。
  只退回「這個分支新增、main 上沒有」的 id，而且只動 `submitted`，已 merge 的不會被碰到。
- **兩邊都保留**：寫進 `wiki-ingest` skill 跟兩份 eli5；`export.ts` 兩句過頭的註解改掉
  （"their PRs cannot conflict"、"a merge is always a clean append"）。
- **PR 說明**：「頁面：`wiki/`」→「文件：見 `README.md` 索引」。
- **`dm setup` 的 repo 結構檢查**：`wiki` → `README.md`。測試夾具原本放著 `wiki/`，所以舊檢查一直通過；
  夾具改成跟範本一樣之後，測試先失敗、改完通過。
- **`dm entities` 改成看文件內容**：原本找 frontmatter `type: entity` 的頁面，新文件沒有 frontmatter，所以
  每張表永遠被列成「還沒有頁面」（連寫在 `spec/testing-point-to-erp.md` 裡的 `erp_data_record`、`ErpDataRecordType`
  也是）。現在只要任何一份文件提到這個名字（不分大小寫）就算有。真實資料跑完剩下三個確實沒有文件寫到的：
  `/bu-record-count/create`、`/apis/order/create`、`erp_product_data`。`wiki-lint` 改成提議「在用到它的
  流程文件裡補一節」，不再提議每張表一頁。查詢用 `status is not 'superseded'`，NULL 也不會被排除。
- **session 開頭那句 hook**（`session-start.ts:28`）原本叫 AI「回答完就提議存成一頁」，改成「把答案存成
  note 卡片；文件是一個主題一份、主題完成時用 wiki-ingest 寫」。`mem-save` skill 最後那句「wiki 就是這樣長大的」
  也改成「note 是原料，不是文件」。
- **`init-repo` 跑完的提示**改成叫人跑 `index-docs`，不再提 `wiki/index.md`。
- **`dm stale` 重寫**：原本只掃 `wiki/`、靠 frontmatter `code_refs`，新文件都沒有，所以永遠回報 0 份
  （舊測試用 `wiki/`＋frontmatter 的假資料，所以壞了還是會過）。現在讀文件最後的「程式碼位置」表
  （內容｜repo｜分支｜路徑，可寫「同上」、資料夾、`{a,b}`），用本機 clone 查那個分支在**文件最後一次 commit**
  之後有沒有改過、路徑還在不在。不用 `gh`、不用連網，只看本機最後一次 fetch 到的內容。解析在 `code-refs.ts`
  （拆出來避免 lint ↔ staleness 互相 import）。lint 只在文件有這張表時才檢查格式跟 repo 名稱。
  真實資料：`spec/testing-point-to-erp.md` 的 6 個路徑都查得到，0 份過時；手動核對過兩個 repo 最後修改都早於文件。
  範本 `schema.md` 已寫明格式；**既有文件 repo 裡的 `schema.md` 是複本，不會自動更新**。
- `bun test` 166 個：165 過、1 個失敗是環境問題（見下）。

### 還沒修

- **PR 在 GitHub 上關掉沒 merge**：卡片會停在 `submitted`。要用 `gh` 查 PR 狀態才能判斷，這次不處理。
- **`test/tokenize.claude-mem.test.ts` 只有 claude-mem 開著才會過**：`claude-mem.db` 是 WAL 模式，claude-mem
  停掉後 `-wal`／`-shm` 被收掉，唯讀連線建不出 `-shm` 就打不開。要改就用 `immutable=1` 開，這次沒動。

- **`DOC_DIRS` 寫死七個資料夾**：`sync` 只收 `spec/ maintenance/ guidelines/ config/ dr/ bank/ poc/` 裡的文件。
  billing 的文件都在裡面，沒事；別的產品的文件 repo 用其他資料夾名稱的話，那些文件進不了搜尋，也沒有提示。
- **日期用 UTC**：分支名稱跟卡片檔的月份都是 `toISOString()`。台灣早上 8 點前開的 ingest，分支名稱是前一天；
  每月 1 號早上 8 點前存的卡片會放進上個月的檔。只影響命名。

### 決定不做

- 中文 `git user.name` 會讓卡片檔名變成 `-.jsonl`（分支名稱反而保留中文）。公司如果都用 `firstname.lastname` 就不影響。
- 同一個人同時開兩個都帶新卡片的 PR，會在卡片檔衝突。不做結構性修法，PR 當下兩邊都保留就好。
  依序 ingest（前一個 merge 後才開下一個）實測不會衝突，因為 `ingest-start` 會先 fetch `origin/main`。


## 2026-09-26：個人模式 × 團隊模式，Phase 4 改為產品化，0.7.0（M1）

### Goal

Bill 問：「沒設定文件 repo 時，能不能把 plugin 當 claude-mem 那樣的中文記憶用？」接著把目標擴大成
**個人模式跟團隊模式都要做到正式產品的水準**。完整的差距分析跟 M1–M4 在 `docs/PLAN.md` 的 Phase 4。

### 結論

本來就不強綁文件庫：收對話、中文搜尋、`mem-save` 都不讀 `memory.repo`。缺的只是它沒被當成正式模式：
- `setup` 把「沒設定」算 ✗
- hook 會把 AI 引導到必失敗的 wiki-ingest
- skill 說卡片「等提交」

跟 claude-mem 比，中文搜尋這塊本來就比較強。真正少的只有兩樣：session 開頭自動帶入最近的記憶、記得做過哪些操作。

### Current Status

- plugin **0.7.0**，`bun test` **172 pass / 0 fail**。M1 跟 eli5 review 一起 commit 在 `master`（Bill 指示直接 commit、不開分支、不 push）。
- M1 完成：
  - `setup`：個人模式算 ✓，這時也不需要 `gh`
  - SessionStart：觸發句放寬；個人模式不提 wiki-ingest
  - 新增 `mem-search` skill
  - `export` 範圍：只帶 `repos.yaml` 列的 code repo 裡存的卡片；例外用 `--id`
  - `db.ts` 註解改成實話、補備份說明、README 加兩種用法
- 隔離的 `DEV_MEMORY_HOME` 實跑過：setup 全 ✓；`record` 印出本機路徑；搜得到；沒設定文件庫時 `sync` 仍 exit 2。
- `dist/mcp-server.js` 重新打包後內容不變，不用更新；`dist/review-ui/app.js` 因為下面的審核頁修正重新打包了。
- **審核頁「來源紀錄」分頁原本永遠是空的**（eli5 review 時發現）：它只去 frontmatter 找卡片 id，但 `schema.md`
  規定文件不能有 frontmatter。現在改成列出這次 ingest 一起送出的卡片（新的 `/api/cards`，直接讀 worktree 裡
  records 檔這個分支新增的行），再加上文件內文引用到的其他卡片 id。
- **eli5 兩份完整 review 過**，照現在的程式碼跟決定修了約 40 處，主要是：
  - 對話紀錄「預設 14 天」→ Claude Code 預設是 **30 天**（官方 data-usage 文件；14 天是 Bill 自己的 `cleanupPeriodDays`）
  - 「本機資料庫隨時可刪、重建就好」→ 要備份
  - 已經不存在的東西：`index.md`、「已取代的頁面」、每張資料表一頁、wiki-ingest 起草卡片、舊的三個確認點
  - 審核頁「每句話的來源」、檢查會擋「缺來源」（沒有這個檢查）
  - 常駐 token：`claude plugin details` 算的是五個 skill 的說明（0.7.0 約 326），不是 session 開頭那段
  - 數字更新：對話 3,807 筆、測試 172 個、審核頁約 92 KB；加上個人模式、mem-search、產品化進度

### Key Decisions Made

- **模式只看 `memory.repo` 有沒有值**，不另加 `mode` 設定，免得兩邊對不上。
- **只有一個文件庫**：不做「一個人接多個文件庫」（Bill：太複雜）。`DOC_DIRS` 改成可設定也一起拿掉，
  它只有另一個產品的文件庫才用得到。
- **export 範圍看 `repos.yaml`（code repo），不看 product 欄位、也不在每次 ingest 時勾選**：
  - 原本 `export` 會把所有 `local` 卡片送進 PR，連別的專案、非 git 目錄存的筆記都會進去。只有一個文件庫也會發生，所以要修。
  - 文件庫沒有 `repos.yaml` 時一張都不送，寧可少送也不誤送。
  - 在非 git 目錄存的卡片要用 `export --id` 才送得出去，或存的時候直接指定 `repos`。
- **讓 AI 主動搜尋**：放寬 SessionStart 那句 ＋ `mem-search` skill。
  - 不在 session 開頭注入最近的紀錄標題。
  - 不用 UserPromptSubmit 每則訊息自動搜（token 成本高、雜訊多）。
- **備份只寫文件，不加指令**：`memory.db` 是舊對話跟個人模式卡片唯一的一份。團隊模式其實也一樣：
  turn 從來不提交，而 Claude Code 的 transcript 預設 30 天就被刪（Codex 的不會自己刪）。
- **隱私（M2）**：只做排除目錄、收錄前遮蔽密鑰。`forget` 跟 `<private>` 沒選。
- **Phase 排序**：Phase 4 = 產品化（M1–M4，做完 1.0.0），Phase 5 推廣不動，語意搜尋移到 Phase 6 選配。

### What Didn't Work / 被否決

- 把 AI 自動壓縮成 observation 當作「像 claude-mem」的做法：這正是當初否決 claude-mem 的理由。

### Next Steps

1. M2 共用底座 → M3 團隊模式補強，一路做完，每一輪 commit（Bill 指示）。
2. M4 由 Bill 驗收：Codex 實測、評測集補到 30 題。
3. eli5 的 commit 也包含 Bill 在這次開始前就有的修改（`eli5-simple` 的「AI 搜的字」表、`eli5` 對應的段落），review 過沒有錯。

### Gotchas Found This Session

- **只看功能能不能跑，會漏掉「預設行為」的外洩**：`export` 沒帶 ids 時選 `status = 'local'` 全部，
  所以在 dev-memory 這個 repo 自己存的卡片，下次寫 billing 文件也會一起送出。要從「誰會收到這筆資料」去想，才看得到。
- **測試夾具要跟真的文件庫一樣有 `repos.yaml`**：export 開始讀它之後，舊夾具沒有這個檔會變成一張都不送。
- **改版面時，UI 也會漏**：frontmatter 拿掉之後，lint、stale、entities 都在 0.6.x 修過，只有審核頁的來源分頁
  沒人發現——它的測試夾具還是帶 frontmatter 的頁面，所以一直是綠的。
- **Codex 不會自己刪 rollout**：本機最舊的一份是 2025-09 的。只有 Claude Code 會照 `cleanupPeriodDays` 刪。
- **Claude Code plugin 可以放 `bin/`**：裡面的執行檔會進 **Bash tool** 的 PATH（排在使用者 PATH 之後），
  但不會進使用者自己的終端機。另外 claude.ai／Cowork 不裝有頂層 `bin/` 的 plugin。M2 的 CLI 入口要考慮這兩點。
- **`claude plugin details` 可以在隔離環境量**：`CLAUDE_CONFIG_DIR=<暫存目錄>` 之後 `marketplace add ./`、`install`、
  `details`，不會碰到 `~/.claude`。同一個 plugin 在不同模型下估出來的 token 會差一點。

### M2 共用底座，0.8.0（2026-09-26）

- `bun test` **188 pass / 0 fail**。
- **排除目錄**：`config.toml` 的 `[capture] exclude`。排除清單由呼叫端傳給 archive（hook、setup、CLI 都有傳），
  archive 自己不讀設定，這樣測試永遠不會讀到真實的 `~/.dev-memory/config.toml`。被排除的行一樣會被讀過去
  （游標照樣前進），所以之後拿掉排除也不會補收。路徑照字面比對，大小寫要跟實際一樣，也不展開 symlink。
- **遮蔽密鑰**：`core/secrets.ts` 的 pattern 由審核頁跟 archive 共用，turn 存進去之前換成 `[REDACTED:種類]`，
  私鑰整塊遮掉，不是只遮標頭。**Bill 決定只遮之後收的**，已經收進來的不動。
  - 決定前先唯讀掃過真實的 `memory.db`，只印數字：3,807 筆對話裡，AWS key 3 筆，全都是這個 repo 測試檔裡
    的假 key；`password/token = "..."` 在 2 筆對話裡共 5 個字串，看不出真假；URL 帳密 1 筆，是範例；卡片 0 筆。
  - 這不是「外洩到團隊」的洞：卡片跟文件進 PR 前，審核頁跟 CI 的 gitleaks 各擋一次。遮蔽處理的是本機這一份：
    它比 Claude Code 的原始對話活得久，也會進備份。
- **設定壞掉時停收**：Stop 跟 SessionStart 都先讀設定。讀不到就寫進 hook.log、這次不收，
  讓排除清單的承諾不會默默失效。游標沒動，修好之後下一次會補齊。
- **`dm` 指令**：SessionStart 每次把 `~/.dev-memory/bin/dm` 跟 `dev-memory` 重寫成指向目前這一版的
  `src/cli.ts`（內容一樣就不寫）。不用 plugin 的 `bin/`，原因有三：它只進 Claude Code 的 Bash tool，
  不進使用者的終端機，也不支援 Codex；而且 claude.ai／Cowork 不裝有頂層 `bin/` 的 plugin。
  README 的 `dm()` 函式拿掉了。
- **hook.log**：兩個 hook 的錯誤寫進 `~/.dev-memory/hook.log`，保留最後 200 行。`setup` 多了 `hook` 那一行：
  最近 7 天有失敗就是 ✗。
- **CI**：`.github/workflows/test.yml`，bun 固定 1.3.4（`dist/` 就是用這版打包的）。步驟是
  `bun test --timeout 20000`，再 `bun run build` + `git diff --exit-code dist/`。
  另外設好 git 使用者名稱，因為審核頁的核准測試會真的 commit。**還沒真的跑過，要 push 之後才會跑。**
  - 有個測試原本要求 setup 全部 ✓，包含 gh 登入。這取決於機器，不是 setup 的結果，所以改成不看 gh；CI 也就不用 token。
- **小項**：
  - MCP server 的版本號改讀 `package.json`。現在 bump 版本之後一定要重新打包。
  - claude-mem 測試改用 `immutable=1` 開，claude-mem 沒在跑也能跑。
  - plugin 跟 marketplace 的描述改成涵蓋兩種模式。
- **順手修的文件漂移**：
  - README 還有「想重來就刪 memory.db」「本機資料庫隨時可以刪」兩句，M1 漏改了。
  - `mem-setup` 的 repo 結構檢查還寫著 `wiki/`。
  - `checks.ts` 開頭的註解還說文件要有 frontmatter。

**Gotcha**：完整測試偶爾有一個審核頁測試卡在 5 秒逾時，單跑 3/3 過、重跑完整 2/2 過。那些測試會建 git repo，
機器忙的時候就慢，所以 CI 把逾時放寬到 20 秒。

### M3 團隊模式補強，0.9.0（2026-09-26）

- **PR 關掉沒 merge**：
  - `dm sync`（沒帶 `--skip-fetch` 時）會列出本機的 `mem/` 分支，只挑已 push、而且還有 `submitted` 卡片的分支，
    用 `gh pr view --json state` 問狀態；是 CLOSED 就把卡片退回 `local`。
  - 卡片 id 是用 git plumbing 從分支的 commit 讀出來的，就是 PR 實際帶的那些，不用開 worktree。
  - 平常 sync 沒有卡住的卡片，所以完全不連網。
  - worktree 留著，由作者自己用 `ingest-discard` 清。`ingest-discard` 原本一律拒絕已 push 的分支，
    現在 PR 已關閉就放行。gh 查不到狀態時當作還開著，照樣拒絕。
  - 測試一律注入 PR 狀態，不會真的呼叫 gh。
- **本地時區**：分支名稱的日期（`localDate`）、卡片檔的月份（`localMonth`）改用作者自己的時區；`created_at` 維持 ISO UTC。
  CI 的 lint 只檢查路徑格式，不比對月份。測試的日期用本地時間建，放到任何時區跑結果都一樣。
- `sync.ts` 開頭註解原本寫「本機索引可以丟掉」，改成實話。

