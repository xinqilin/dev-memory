# dev-memory

開發過程中的決定，自動變成全隊查得到的文件。

Claude Code 與 Codex CLI 共用同一個 plugin、同一份記憶。這個 repo 本身也是 plugin 的 marketplace。

```
你跟 AI 討論 → 自動記錄 → 「把這個決定存起來」 → AI 整理成 wiki → 你在本機審核頁確認 → 送出 PR → 隊友 sync
```

圖解（一頁看完全部）：[docs/eli5.html](docs/eli5.html)　·　完整規劃：[docs/PLAN.md](docs/PLAN.md)　·　進度與決策：[docs/HANDOFF.md](docs/HANDOFF.md)

**目前狀態**：可以用了。蒐集、中文搜尋、決策紀錄、wiki 整理、本機審核頁、PR 提交、跨 repo entity 索引、lint 與過時偵測都完成，端對端跑過一次真實的 PR。第一版**不含語意搜尋**，所以不用裝任何模型。

---

## 五分鐘上手

### 1. 前置需求

| 需要 | 安裝 | 為什麼 |
|---|---|---|
| [Bun](https://bun.sh) | `brew install bun` | hook 跟 MCP server 都是用 `bun` 啟動；**必須在 PATH 裡** |
| git | 通常已經有 | — |
| [gh](https://cli.github.com) 並登入 | `brew install gh && gh auth login` | 提交記憶、開 PR、偵測文件過時 |

### 2. 安裝 plugin

**Claude Code**

```bash
claude plugin marketplace add git@github.com:xinqilin/dev-memory.git
claude plugin install dev-memory@104mis-plugins
```

**Codex CLI**

```bash
codex plugin marketplace add git@github.com:xinqilin/dev-memory.git
codex plugin add dev-memory@104mis-plugins
codex                                     # 啟動時要手動信任 hook，信任完重開一次
```

### 3. 設定

最省事：在對話裡說「**幫我設定 dev-memory**」，走 `mem-setup` skill。

自己來：

```bash
# clone 團隊的記憶 repo
git clone <團隊 memory repo> ~/project-other/<名稱>

# 設定並檢查（把這個函式加進 ~/.zshrc，之後會一直用到）
dm() { bun "$(ls -d ~/.claude/plugins/cache/104mis-plugins/dev-memory/*/src/cli.ts | sort -V | tail -1)" "$@"; }
dm setup --repo ~/project-other/<名稱>
```

`setup` 會建立 `~/.dev-memory`、寫好設定、把既有對話灌進索引、從 `main` 同步隊友的記憶，最後逐項檢查環境。缺什麼就直接告訴你要跑哪一行，可以重複跑。

順利的話會看到：

```
✓ bun        1.3.4  /Users/you/.bun/bin/bun
✓ git        /opt/homebrew/bin/git
✓ gh         已登入
✓ 本機索引     ~/.dev-memory  (schema v2, SQLite 3.51.0)
✓ memory repo ~/project-other/<名稱>
✓ repo 結構    schema.md、wiki/、records/ 都在

都好了。做完一個決定時跟 AI 說「把這個決定存起來」就會開始記。
```

### 4. 確認在運作

開一個新 session，問 AI：「context 裡有 dev-memory 的訊息嗎？」
應該看到 `dev-memory: N turns, M records indexed`。

---

## 平常怎麼用

只有三個時機，而且都是用講的：

| 你想做什麼 | 你說 | 背後發生什麼 |
|---|---|---|
| **查以前怎麼決定的** | 「我們之前為什麼改成不中斷？」 | AI 自動搜記憶（wiki 頁 → 紀錄 → 原始對話），答不出來才翻程式碼 |
| **記下一個決定** | 「把這個決定存起來」 | `mem-save` skill 起草卡片（原因／決定／放棄），你確認才存 |
| **整理成文件** | 「把這次的決定整理成 wiki」 | `wiki-ingest` skill：挑卡片 → 排計畫 → 開本機審核頁，你核准後送出 PR |

另外兩個維護用的：

- 「幫我檢查 wiki」→ `wiki-lint`：壞連結、孤兒頁、沒有來源的內容、程式碼改了但文件沒跟上
- 「幫我設定 dev-memory」→ `mem-setup`：重新檢查環境

**不用你做的事**：每講完一回合自動存檔、開 session 時自動補掃、搜尋自動切中文詞。

**只有你能做的事**：在審核頁按「核准」跟「送出 PR」。AI 不會 push。

---

## 指令

平常用不到，AI 會幫你跑。除錯或想自己來的時候：

| 指令 | 用途 |
|---|---|
| `setup` | **裝完先跑這個**：設定、建索引、同步、檢查環境（`--repo`、`--skip-sweep`、`--skip-sync`） |
| `search <字詞>` | 關鍵字搜尋（`--repo`、`--here`、`--kind`、`--limit`、`--json`） |
| `get <kind> <ref>` | 印出某一筆的完整內容 |
| `sync` | 從 memory repo 的 main 匯入紀錄跟頁面（`--skip-fetch`） |
| `sweep` | 掃描兩個工具的所有對話紀錄，補上漏掉的 |
| `entities` | 紀錄提到哪些資料表、API、queue，誰寫誰讀，哪些還沒有頁面 |
| `lint` | 檢查壞連結、孤兒頁、`sources[]`、同名的 active 頁 |
| `stale` | 問 GitHub：頁面引用的程式碼在那之後有沒有被改過 |
| `eval <file.yaml>` | 用評測集量搜尋準不準（`--suggest` 生候選題目） |
| `review --branch <b>` | 開本機審核頁 |
| `publish --branch <b>` | push 並開 PR（**只有你自己能跑**） |
| `init-repo <dir>` | 把 memory repo 的骨架加進既有 repo，不覆蓋任何現有檔案 |
| `archive <file>` · `init` · `record` · `export` · `ingest-start` · `index-docs` | hook 跟 skill 內部用的 |

---

## 卡住的時候

| 症狀 | 原因 | 怎麼辦 |
|---|---|---|
| 完全沒在記錄 | `bun` 不在 PATH，hook 起不來 | `which bun`；GUI 啟動的工具可能拿不到 shell 的 PATH，從終端機啟動試試 |
| Codex 沒在記錄 | hook 沒被信任 | Codex 裡輸入 `/hooks` 信任 dev-memory 的 hook，然後重開 session |
| `plugin update` 說已經是最新版 | 兩個工具都是**看版本號**決定要不要更新 | 確認 remote 的 `plugin.json` version 有變；沒變就是還沒發版 |
| 搜不到明明討論過的東西 | 說法差太多，或那段對話還沒被收進來 | 換個說法再問一次；`dm sweep` 補收；`dm search <詞> --json` 看實際命中 |
| `setup` 說找不到 memory repo | 還沒 clone 或路徑沒設 | `dm setup --repo <clone 的路徑>` |
| `dm` 跑出來的行為跟文件不符 | cache 裡留著好幾個版本，`*` 會展開成多個路徑，`bun a b` 只會跑第一個（最舊的） | 用上面那個 `dm()` 函式，不要用 `alias dm='bun .../*/src/cli.ts'`；`dm --help` 的第一行會印版本 |
| 審核頁沒有樣式、清單空白 | 用到舊版的 plugin | 更新 plugin 後重開；網址要含 `?token=` |
| 審核頁「核准」按不下去 | 有檢查沒過 | 看「檢查結果」分頁，點檔名跳過去修 |
| 「送出 PR」是灰的 | 還沒 commit | 先按「核准並 commit」 |
| `stale` 說查不到 | `gh` 沒登入，或沒有那個 code repo 的權限 | `gh auth login`；沒權限的 repo 會被略過，不會猜 |
| 想重來 | 本機索引是可丟棄的 | 刪掉 `~/.dev-memory/memory.db`，再跑 `dm setup` |

---

## 資料放在哪、誰看得到

| 東西 | 放哪 | 誰看得到 |
|---|---|---|
| 原始對話 | `~/.dev-memory/memory.db`（你自己的電腦） | **只有你**，不會提交 |
| 卡片（紀錄） | 團隊 memory repo 的 `records/` | 有 repo 權限的人 |
| wiki 頁面 | 團隊 memory repo 的 `wiki/` | 有 repo 權限的人 |
| 向量 | 沒有，第一版不做語意搜尋 | — |

三道防線擋機密：本機審核頁掃到疑似金鑰／個資就不給核准、CI 跑 gitleaks 掃全 repo、`schema.md` 明文寫哪些東西不能寫進去。

本機資料庫隨時可以刪：正本在 repo，原始對話還在你硬碟上，重建就好。

---

## 給維護者

```bash
cd plugins/dev-memory
bun test          # 140 個測試
bun run build     # 改完 src/ 要重新打包 dist/
```

```
plugins/dev-memory/
├── .claude-plugin/plugin.json   # Claude Code 讀這份
├── plugin.json                  # Codex 讀這份（Agent Plugins 1.0.0）
├── .mcp.json / mcp.json         # Claude Code 只讀前者，Codex 只讀後者，兩份都要留
├── hooks/hooks.json             # 兩邊共用：SessionStart 補掃、Stop 增量存檔
├── skills/{mem-setup,mem-save,wiki-ingest,wiki-lint}/SKILL.md
├── src/
│   ├── cli.ts                   # 所有功能的入口
│   ├── mcp-server.ts            # memory_search / memory_get
│   ├── hooks/{session-start,stop}.ts
│   ├── adapters/{claude-code,codex}.ts    # 兩種 transcript → 同一種 turn
│   ├── review/{server,checks,ui}          # 本機審核頁
│   └── core/*.ts                # db、搜尋、斷詞、同步、worktree、lint…
├── dist/{mcp-server.js,review-ui/}        # 打包產物，要 commit 進 repo
├── eval/queries.example.yaml
└── test/
templates/memory-repo/           # init-repo 會複製到 memory repo 的骨架
```

**發版流程**：改完 → `bun test` → `bun run build` → 把 `plugin.json`、`.claude-plugin/plugin.json`、`package.json` 三個版本號一起 bump → commit → push。**沒 bump 版本號，隊友 `plugin update` 不會拉到新版。**

**幾條不能違反的規則**：

- Skill 內容不能寫死任何一個工具專屬的 tool 名稱（要同時支援兩邊）
- 使用者資料一律 `~/.dev-memory/`，不用 `CLAUDE_PLUGIN_DATA` 或 `PLUGIN_DATA`
- 記憶、對話、真實資料**絕對不能進這個 repo**——plugin 會整包複製到每個安裝者的機器
- `dist/` 要 commit：從 git 安裝的 marketplace 不會有 `node_modules`
- plugin 不自己安裝軟體（Bun、gh、之後的 Ollama 都要使用者同意）

---

私有 repo，公司內部使用。`git push` 一律由使用者自己執行。
