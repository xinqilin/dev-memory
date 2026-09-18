# dev-memory

Claude Code 與 Codex CLI 共用的團隊開發記憶 plugin，搭配由 LLM 維護的 wiki。這個 repo 本身也是 plugin 的 marketplace。

**目前狀態：Phase 3。** 蒐集、中文搜尋、決策紀錄、wiki ingest、本機審核頁、PR 提交、entity 索引、lint 跟過時偵測都能用了；語意搜尋（Phase 4）還沒做。完整規劃看 [docs/PLAN.md](docs/PLAN.md)，進度跟決策看 [docs/HANDOFF.md](docs/HANDOFF.md)，Phase 0 的實測結果看 [docs/spikes/phase-0.md](docs/spikes/phase-0.md)。

## 前置需求

| 需求 | 說明 |
|---|---|
| [Bun](https://bun.sh) | `brew install bun`。**`bun` 必須在 PATH 裡**，hook 跟 MCP server 都是用 `bun` 啟動的；GUI 啟動的工具如果拿不到 shell 的 PATH 會整個不動 |
| git | 一般安裝即可 |
| `gh auth login` | 提交記憶、開 PR、以及 `stale` 查 GitHub 用 |

## 安裝

### Claude Code

開發時直接指定本機目錄：

```bash
claude --plugin-dir ./plugins/dev-memory
```

從 marketplace 安裝：

```bash
claude plugin marketplace add git@github.com:xinqilin/dev-memory.git
claude plugin install dev-memory@104mis-plugins
```

### Codex CLI

```bash
codex plugin marketplace add ./          # 或 git@github.com:xinqilin/dev-memory.git
codex plugin add dev-memory@104mis-plugins
codex mcp list                            # 應該看得到 dev-memory
codex
```

**Codex 的 hook 要手動信任才會執行。** 啟動時會出現 hook 審查畫面，或輸入 `/hooks` 信任 dev-memory 的 SessionStart hook，信任完要重開 session。

## 裝完之後（一定要做）

最省事的方式是在對話裡說「**幫我設定 dev-memory**」，走 `mem-setup` skill，它會問你要把記憶 repo 放哪、然後把下面這些做完。

自己來的話：

```bash
# 1. 先 clone 團隊的記憶 repo
git clone <團隊 memory repo> ~/project-other/<repo 名稱>

# 2. 設定並檢查（安裝後的 plugin 在 cache 裡，路徑用萬用字元展開）
alias dm='bun ~/.claude/plugins/cache/104mis-plugins/dev-memory/*/src/cli.ts'
dm setup --repo ~/project-other/<repo 名稱>
```

`setup` 會：建立 `~/.dev-memory`、寫好設定、把既有對話灌進索引、從 `main` 同步隊友的記憶，最後逐項檢查 `bun`、`git`、`gh`、FTS5、repo 結構，缺什麼就直接告訴你要跑哪一行。可以重複跑。

## 確認裝好了

安裝後開一個新 session，然後：

| 檢查 | 怎麼看 | 預期 |
|---|---|---|
| Hook | 問 AI：「context 裡有 dev-memory 的訊息嗎？」 | `dev-memory: N turns, M records indexed` |
| MCP | Claude Code 打 `/mcp` | `dev-memory` 是 connected，有 `memory_search`、`memory_get` |
| Skill | 做完一個決定後說「把這個決定存進記憶」 | 走 mem-save skill，列出草稿讓你確認 |

也可以直接用 CLI：

```bash
cd plugins/dev-memory
bun src/cli.ts init                 # 建立 ~/.dev-memory、索引、設定
bun src/cli.ts sweep                # 掃描兩個工具既有的對話紀錄
bun src/cli.ts search 例外處理       # 中文、英文、程式識別字都吃
bun src/cli.ts eval eval/queries.example.yaml   # 量搜尋準不準
```

## 指令

| 指令 | 用途 |
|---|---|
| `setup` | **裝完先跑這個**：設定 memory repo、建索引、同步、逐項檢查環境（`--repo`、`--skip-sweep`、`--skip-sync`） |
| `init` | 建立 `~/.dev-memory`、索引跟設定，並檢查 SQLite 有沒有 FTS5 |
| `archive <file>` | 只讀某個 transcript 的新增部分（Stop hook 用的就是這個） |
| `sweep` | 掃描兩個工具的所有對話紀錄，補上漏掉的 |
| `search <query>` | 關鍵字搜尋（`--repo`、`--here`、`--kind`、`--limit`、`--json`） |
| `get <kind> <ref>` | 印出某一筆的完整內容 |
| `record` | 從 stdin 讀 JSON 存成一筆紀錄 |
| `eval <file.yaml>` | 用評測集量 Recall@5 跟 MRR（`--suggest` 從記憶生候選題目） |
| `init-repo <dir>` | 把 memory repo 的骨架加進既有 repo，不覆蓋任何現有檔案 |
| `sync` | 從 memory repo 的 main 匯入紀錄跟頁面（`--skip-fetch`） |
| `ingest-start <slug>` | 開一個 worktree 準備整理 wiki |
| `export --branch <b>` | 把本機紀錄寫成 JSONL 提交到 repo |
| `index-docs` | 把 repo 既有的人工文件列進 `wiki/index.md` |
| `entities` | 紀錄提到哪些資料表、API、queue，誰寫誰讀，哪些還沒有頁面 |
| `lint` | 檢查壞連結、孤兒頁、`sources[]`、同名的 active 頁 |
| `stale` | 問 GitHub：頁面引用的程式碼在那之後有沒有被改過 |
| `review --branch <b>` | 開本機審核頁 |
| `publish --branch <b>` | push 並開 PR（**只有你自己能跑**） |

## 資料放在哪

所有使用者資料一律在 `~/.dev-memory/`，不在 plugin 目錄裡，也不會進這個 repo。記憶的正本在另一個 memory repo，透過 PR 提交；本機的 SQLite 只是索引，刪掉可以重建。

## 開發

```bash
cd plugins/dev-memory
bun test          # 目前 140 個測試
```

```
plugins/dev-memory/
├── .claude-plugin/plugin.json   # Claude Code 讀這份
├── plugin.json                  # Codex 讀這份（Agent Plugins 1.0.0）
├── .mcp.json                    # Claude Code 讀這份
├── mcp.json                     # Codex 只讀這份，不讀 .mcp.json
├── hooks/hooks.json             # 兩邊共用：SessionStart 補掃、Stop 增量存檔
├── skills/{mem-setup,mem-save,wiki-ingest,wiki-lint}/SKILL.md
├── src/
│   ├── cli.ts                   # 所有功能的入口
│   ├── mcp-server.ts            # memory_search / memory_get
│   ├── hooks/{session-start,stop}.ts
│   ├── adapters/{claude-code,codex}.ts
│   ├── review/{server,checks,ui}  # 本機審核頁
│   └── core/{db,config,setup,archive,search,tokenize,repo-id,record,git-files,eval,
│             sync,worktree,export,index-docs,init-repo,publish,entities,lint,staleness}.ts
├── dist/{mcp-server.js,review-ui/}  # 打包好的 MCP server 跟審核頁，改完 src 要 `bun run build`
├── eval/queries.example.yaml
└── test/
```

改完 `src/mcp-server.ts` 或它相依的檔案後要重新打包：

```bash
bun run build
```

打包進 repo 是刻意的：從 git 安裝的 marketplace 不會有 `node_modules`。

兩份 MCP 設定不能刪掉任何一份：Claude Code 只讀 `.mcp.json`，Codex 只讀 `mcp.json`（Phase 0 實測，見 spike 文件）。Skill 的內容不能寫死任何一個工具專屬的 tool 名稱。

## 注意

私有 repo，公司內部使用。`git push` 一律由使用者自己執行。
