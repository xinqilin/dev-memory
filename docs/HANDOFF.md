# Handoff — 2026-09-17 17:40

## Goal

把 Bill 個人的文件流程（claude-mem → `/n8n-doc-sync` → n8n → Google Chat → Apps Script → PR）做成團隊可以安裝的 plugin `dev-memory`，需求如下：
- 同時支援 Claude Code 與 Codex CLI
- 開發記憶長期保存、可以跨 repo 搜尋
- 由 LLM 維護 wiki，wiki 就是文件
- 用 PR 提交，分享給全隊

## Current Status

- **規劃已完成，還沒開始實作**，Phase 0 尚未開始。
- 完整計畫在 `docs/PLAN.md`，原檔是 `~/.claude/plans/claude-mem-luminous-naur.md`。
- 圖解在 `docs/eli5.html`，線上版：https://claude.ai/artifact/XFAiD5kPUgS5jmHi4ZDfGq
- `/Users/bill.lin/project-plugin` 還不是 git repo。
- `PLAN.md` 最後有 4 項「待確認決策」，目前先照預設值往下做。

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

## Key Decisions Made

- **正本**：放在 GitHub 的 memory repo。
  - `records/<product>/<yyyy-mm>/<author>.jsonl`：只新增不修改，一人一月一檔
  - `wiki/`：LLM 維護的文件
  - `schema.md`：規則，取代原本放在 n8n 裡的 prompt
  - `repos.yaml`：產品跟 repo 的對應
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
- **Runtime**：Bun + `bun:sqlite`（已確認 Bun 的 build flag 有開 FTS5）。
- **兩個工具共用**：
  - manifest 跟 MCP 設定各一份
  - skills 共用，內容不寫死任何工具專屬的 tool 名稱
  - 主要靠 Stop hook 增量存檔
- **預設值（待 Bill 確認）**：
  - memory repo 另開一個 104corp 團隊 repo（因為會跨 billing、crm、aisr 等產品）
  - plugin 名稱用 `dev-memory`
  - 不匯入 claude-mem 現有的 observation

## Next Steps

1. Bill 確認 `PLAN.md` 裡的 4 項待確認決策，並提供：
   - n8n workflow 的 export JSON（prompt、category/slug 規則）
   - 產品跟 repo 的對應清單
   - 104corp 能不能建私有 repo
2. Phase 0.1：在本目錄 `git init`。
3. Phase 0.2–0.3：做一個 hello plugin，在兩個工具上驗證三件事：
   - `hooks/hooks.json` 能不能兩邊共用
   - Codex 的 plugin 能不能帶本機 stdio MCP
   - 私有 marketplace 能不能安裝
4. Phase 0.4–0.6：
   - 驗證 `bun:sqlite` 的 FTS5
   - 寫 `tokenize.ts`，用 claude-mem 那 4,069 筆測
   - 寫 `repo-id.ts`
5. Phase 0 結束時停下，給 Bill diff 摘要。

## Critical Files

- `docs/PLAN.md`：完整規劃，包含架構、相容性表、資料格式、Phase 0–5 步驟與驗證方式。
- `docs/eli5.html`：圖解（瀏覽器開檔，或看上面的線上連結）。
- `~/.claude-mem/scripts/sync-to-n8n.sh`：現行撈資料的邏輯，是要取代的對象。
- `~/.claude/skills/n8n-doc-sync/SKILL.md`：現行 skill。`--feature` 跟 `maintenance/` 路徑的語意要保留；注意 `~/.claude` 有未 commit 的修改。
- `~/Desktop/appscript/appScript.gs`：現行的審核跟開 PR 流程；為什麼不開 Draft PR 寫在 483–488 行。
- `~/.claude-mem/claude-mem.db`：tokenizer spike 的測試資料（唯讀使用）。
- `~/.claude/projects/-Users-bill-lin-project-backend-104mis-billing-batch-aws/*.jsonl`：Claude transcript fixture 的來源。
- `~/.codex/sessions/**/rollout-*.jsonl`：Codex rollout fixture 的來源。

## Gotchas Found This Session

- **本次討論也會被刪**：Bill 的 `cleanupPeriodDays` 設 14，這次討論的 transcript 大約 2026-10-01 就會被刪，只能靠這份檔案保存。
- **Claude transcript 的 user 行要過濾**：`isMeta`、`tool_result`、`<task-notification>`、`<command-*>`；subagent 的對話另外放在 `subagents/` 目錄。
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
- **Ollama 預設會把模型留在記憶體 5 分鐘**：請求要帶 `keep_alive: "30s"`。`/api/embed` 支援批次跟 `dimensions`，回傳的向量已經 L2 正規化。
- **Qwen3-Embedding 查詢要加前綴**（`Instruct: {task}\nQuery: {query}`），不加會掉 1–5%；文件本身不用加。bge-m3 不需要前綴。
- **claude-mem 的 Chroma 現況**：1.0GB、58,073 筆向量、384 維，collection 設定是 `{}`，也就是用 Chroma 預設的英文模型。

## 在其他地方接手

- **這個目錄**：`AGENTS.md` 會指向本檔跟 `PLAN.md`，Claude Code 透過 `CLAUDE.md` 的 `@AGENTS.md` 會自動讀到。
- **原始對話**：`cd ~/.claude && claude --resume ecdd633f-1cf1-4e5c-9fb1-483d5916be0f`，14 天內有效。

## Active Skill

無。規劃階段已結束，還沒進入實作。
