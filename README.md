# dev-memory

AI 讀程式碼寫出技術文件，用你存下來的開發紀錄補上「當初為什麼」，你審核後送 PR。

Claude Code 與 Codex CLI 共用同一個 plugin、同一份記憶（Codex 那半尚未實測）。這個 repo 本身也是 plugin 的 marketplace，名稱 `104mis-plugins`。

```
你說「寫一份 X 的文件」→ AI 讀程式碼 → 給你大綱確認 → 寫成文件
    → 你在本機審核頁改到滿意 → 你按送出 PR → 隊友 sync
```

背景還有一條路一直在跑，跟你做不做上面的事無關：**每講完一回合，對話自動進本機索引**。

圖解（一頁看完全部）：[docs/eli5.html](docs/eli5.html)　·　完整規劃：[docs/PLAN.md](docs/PLAN.md)　·　進度與決策：[docs/HANDOFF.md](docs/HANDOFF.md)

**目前狀態**：可以用了。蒐集、中文搜尋、讀程式碼寫文件、本機審核頁、PR 提交、lint 與過時偵測都完成，端對端跑過兩次真實的 PR。第一版**不含語意搜尋**，所以不用裝任何模型。

---

## 五分鐘上手

### 1. 前置需求

| 需要 | 安裝 | 為什麼 |
|---|---|---|
| [Bun](https://bun.sh) | `brew install bun` | hook 跟 MCP server 都是用 `bun` 啟動；**必須在 PATH 裡** |
| git | 通常已經有 | — |
| [gh](https://cli.github.com) 並登入 | `brew install gh && gh auth login` | 提交記憶、開 PR、偵測文件過時 |

### 2. 安裝 plugin（Claude Code）

**兩步：先加 marketplace，再裝 plugin。**

```bash
# 1. 把這個 repo 註冊成 marketplace（名稱是 104mis-plugins）
claude plugin marketplace add git@github.com:xinqilin/dev-memory.git

# 2. 安裝
claude plugin install dev-memory@104mis-plugins
```

裝完**重開 Claude Code**才會生效。

驗證：

```bash
claude plugin list                    # 應該看到 dev-memory 跟版本號
claude plugin details dev-memory      # 列出 skill、hook、MCP，以及常駐 token 成本
```

#### 常用指令

| 指令 | 用途 |
|---|---|
| `claude plugin list` | 看裝了什麼、什麼版本 |
| `claude plugin update dev-memory` | 更新到最新版（**要重開才生效**） |
| `claude plugin marketplace update 104mis-plugins` | 只更新 marketplace 清單，不動已裝的 plugin |
| `claude plugin uninstall dev-memory` | 移除 |
| `claude plugin disable dev-memory` / `enable` | 暫時停用／啟用，不用移除 |
| `claude plugin marketplace list` | 看註冊了哪些 marketplace |

`marketplace add` 的來源可以是 **git URL、本機路徑、或 GitHub repo**。開發時指到本機最方便：

```bash
claude plugin marketplace add ~/project-plugin
```

> **更新拉不到新版？** 兩個工具都是**看版本號**決定要不要更新。`plugin.json` 的 version 沒變，`update` 就會回「已經是最新版」——即使程式碼改了。發版一定要 bump（見下方〈給維護者〉）。

**Codex CLI**：plugin 那一半（`plugin.json`、`mcp.json`、hook）已經做好了，但**安裝語法還沒實測過**，等驗證後再補。

### 3. clone 團隊的文件庫

```bash
git clone <團隊文件 repo> ~/project-other/<名稱>
```

clone 到哪都行，下一步會告訴 plugin。

### 4. 跑一次 setup ← **做完這步就能用了**

把這個函式加進 `~/.zshrc`（之後會一直用到）：

```bash
dm() { bun "$(ls -d ~/.claude/plugins/cache/104mis-plugins/dev-memory/*/src/cli.ts | sort -V | tail -1)" "$@"; }
```

然後：

```bash
dm setup --repo ~/project-other/<名稱>
```

也可以在對話裡說「**幫我設定 dev-memory**」，走 `mem-setup` skill。

這一步會：

1. 建立 `~/.dev-memory/`
2. **產生 `~/.dev-memory/config.toml`** ← 設定檔在這時才出現，**不在 plugin 裡**
3. 建立空的 `memory.db`（schema 是 dev-memory 自己建的，不依賴任何其他工具）
4. 把你既有的對話紀錄灌進索引
5. 從 `main` 同步隊友已經寫好的文件
6. 逐項檢查環境，缺什麼直接告訴你要跑哪一行

順利的話會看到：

```
✓ bun        1.3.4  /Users/you/.bun/bin/bun
✓ git        /opt/homebrew/bin/git
✓ gh         已登入
✓ 本機索引     ~/.dev-memory  (schema v2, SQLite 3.51.0)
✓ memory repo ~/project-other/<名稱>
✓ repo 結構    schema.md、spec/、records/ 都在
```

可以重複跑，**不會覆蓋你手改過的 `config.toml`**。

### 5. 告訴它程式碼在哪（要寫文件才需要）

```bash
dm repos --save
```

它會掃 `~/project-backend`、`~/project-frontend`、`~/project-other` 這些慣例目錄，用 git remote 比對 `repos.yaml` 裡的 repo，找到就寫進 `config.toml` 的 `[repos]`。

找不到的會直接印出要貼的那一行，例如：

```toml
[repos]
"104corp/example-service" = "~/你 clone 的位置/example-service"
```

> **為什麼路徑不寫在 `repos.yaml`**：那個檔案在團隊文件庫裡、會發給每個人，而每個人 clone 的位置都不同。`repos.yaml` 只寫 repo 身分跟要讀哪幾支分支，本機路徑各自放在自己的 `config.toml`。

### 6. 確認在運作

開一個新 session，問 AI：「context 裡有 dev-memory 的訊息嗎？」
應該看到 `dev-memory: N turns, M records indexed`。

---

## 平常怎麼用

**真正要你主動開口的只有一句**：「幫我寫一份〈主題〉的文件」。其他都是它來問你。

| | 誰觸發 | 你要做什麼 |
|---|---|---|
| 對話存檔 | **完全自動**（每講完一回合） | 什麼都不用做 |
| 存卡片 | **AI 會主動提議** | 說「好」，或改一改再存 |
| 寫文件 | **只有你能開口** | 說「幫我寫一份〈主題〉的文件」 |

| 你想做什麼 | 你說 | 背後發生什麼 |
|---|---|---|
| **查以前怎麼做的** | 「測評點數怎麼拋到 ERP？」 | AI 自動搜記憶（文件 → 紀錄 → 原始對話），答不出來才翻程式碼 |
| **存一個決定** | AI 問你就點頭，或自己說「把這個決定存起來」 | `mem-save` 起草卡片（原因／決定／放棄），**你看過才存** |
| **寫文件** | 「幫我寫一份 sap-create-bu-data 的文件」 | `wiki-ingest`：讀程式碼 → 給你骨架確認 → 寫文件 → 開審核頁 |

主題要具體：**一支批次、一條資料流、一個子系統**，不是「最近的幾個決定」。

另外兩個維護用的：

- 「幫我檢查文件」→ `wiki-lint`：壞連結、沒被索引的頁、程式碼改了但文件沒跟上
- 「幫我設定 dev-memory」→ `mem-setup`：重新檢查環境

想確定叫到某個 skill，就打斜線指令：`/dev-memory:wiki-ingest`。

**只有你能做的事**：在審核頁按「核准」跟「送出 PR」。AI 不會 push。

---

## 指令

平常用不到，AI 會幫你跑。除錯或想自己來的時候：

| 指令 | 用途 |
|---|---|
| `setup` | **裝完先跑這個**：設定、建索引、同步、檢查環境（`--repo`、`--skip-sweep`、`--skip-sync`） |
| `search <字詞>` | 關鍵字搜尋（`--repo`、`--here`、`--kind`、`--limit`、`--json`） |
| `get <kind> <ref>` | 印出某一筆的完整內容 |
| `sync` | 從文件庫的 main 匯入紀錄跟文件（`--skip-fetch`）。**PR merge 後要自己跑，不會自動** |
| `repos` | 每個 code repo 在這台機器的哪裡（`--save` 寫進 config.toml、`--product`） |
| `sweep` | 掃描兩個工具的所有對話紀錄，補上漏掉的 |
| `entities` | 紀錄提到哪些資料表、API、queue，誰寫誰讀，哪些還沒有頁面 |
| `lint` | 檢查壞連結、沒被 README 索引的文件、殘留的 frontmatter |
| `stale` | 問 GitHub：頁面引用的程式碼在那之後有沒有被改過 |
| `eval <file.yaml>` | 用評測集量搜尋準不準（`--suggest` 生候選題目） |
| `review --branch <b>` | 開本機審核頁 |
| `publish --branch <b>` | push 並開 PR（**只有你自己能跑**） |
| `init-repo <dir>` | 把文件庫的骨架加進既有 repo，不覆蓋任何現有檔案 |
| `index-docs` | 把 repo 原本就有的人工文件補進 README 索引（接手既有文件庫時用） |
| `archive <file>` · `init` · `record` · `export` · `ingest-start` | hook 跟 skill 內部用的 |

---

## 卡住的時候

| 症狀 | 原因 | 怎麼辦 |
|---|---|---|
| 完全沒在記錄 | `bun` 不在 PATH，hook 起不來 | `which bun`；GUI 啟動的工具可能拿不到 shell 的 PATH，從終端機啟動試試 |
| Codex 沒在記錄 | hook 沒被信任 | Codex 裡輸入 `/hooks` 信任 dev-memory 的 hook，然後重開 session |
| `plugin update` 說已經是最新版 | 兩個工具都是**看版本號**決定要不要更新 | 確認 remote 的 `plugin.json` version 有變；沒變就是還沒發版 |
| 搜不到明明討論過的東西 | 說法差太多，或那段對話還沒被收進來 | 換個說法再問一次；`dm sweep` 補收；`dm search <詞> --json` 看實際命中 |
| `setup` 說找不到文件庫 | 還沒 clone 或路徑沒設 | `dm setup --repo <clone 的路徑>` |
| 寫文件時說找不到程式碼 | `config.toml` 的 `[repos]` 沒有那個 repo | `dm repos --save`；它掃不到的會印出要貼的那一行 |
| 文件寫出來跟實際行為不符 | 讀到的分支不對 | `dm repos` 看 `refs` 順序。有的 repo `dev` 比 `master` 新，有的相反 |
| merge 了卻搜不到新文件 | `sync` 沒跑 | `dm sync`。開 session 自動做的是補收對話，不是拉團隊文件 |
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
| 你的設定與程式碼路徑 | `~/.dev-memory/config.toml`（你自己的電腦） | **只有你**，不進 git |
| 卡片（紀錄） | 團隊文件庫的 `records/` | 有 repo 權限的人 |
| 文件 | 團隊文件庫的 `spec/`、`maintenance/` | 有 repo 權限的人 |
| 向量 | 沒有，第一版不做語意搜尋 | — |

三道防線擋機密：本機審核頁掃到疑似金鑰／個資就不給核准、CI 跑 gitleaks 掃全 repo、`schema.md` 明文寫哪些東西不能寫進去。

本機資料庫隨時可以刪：正本在 repo，原始對話還在你硬碟上，重建就好。

---

## 給維護者

```bash
cd plugins/dev-memory
bun test          # 160 個測試
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
│   └── core/*.ts                # db、搜尋、斷詞、同步、worktree、lint、repos…
├── dist/{mcp-server.js,review-ui/}        # 打包產物，要 commit 進 repo
├── eval/queries.example.yaml
└── test/
templates/memory-repo/           # init-repo 會複製到文件庫的骨架（schema.md 是規則書）
```

**發版流程**：改完 → `bun test` → `bun run build` → 把 `plugin.json`、`.claude-plugin/plugin.json`、`package.json` 三個版本號一起 bump → commit → push。**沒 bump 版本號，隊友 `plugin update` 不會拉到新版。**

**幾條不能違反的規則**：

- Skill 內容不能寫死任何一個工具專屬的 tool 名稱（要同時支援兩邊）
- 使用者資料一律 `~/.dev-memory/`，不用 `CLAUDE_PLUGIN_DATA` 或 `PLUGIN_DATA`
- 記憶、對話、真實資料**絕對不能進這個 repo**——plugin 會整包複製到每個安裝者的機器
- `repos.yaml` 是共用的，**不准出現任何人的本機路徑**；那些放各自的 `config.toml`
- `dist/` 要 commit：從 git 安裝的 marketplace 不會有 `node_modules`
- plugin 不自己安裝軟體（Bun、gh、之後的 Ollama 都要使用者同意）

---

私有 repo，公司內部使用。`git push` 一律由使用者自己執行。
