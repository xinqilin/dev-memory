# dev-memory

繁體中文 · [English](README.en.md)

**給用中文跟 AI 寫程式的開發者。** 你跟 Claude Code、Codex CLI 的對話會自動存成本機記憶，中文也搜得到。
需要文件時，AI 會讀程式碼寫出規格，再用你存下的開發紀錄補上「當初為什麼」，你審核過後自己送 PR。

- **中文搜得到**：中文沒有空格，一般的全文檢索會把一整句當成一個詞。dev-memory 存進去之前會先切成兩字一塊、再加上單字，
  不靠詞庫，也不靠模型。實測同一份資料搜「例外」：SQLite 預設的切法在 12 筆裡只找到 3 筆，這裡 12 筆全中。
- **英文跟程式識別字也搜得到**：`invoiceStatus`、`WAIT_FOR_INSERT_STAGING_DB` 會整個保留，同時拆成 `invoice`、`status`。
  中英混著講正是它最擅長的情況。
- **兩個工具共用一份記憶**：Claude Code 跟 Codex CLI 裝的是同一個 plugin，寫進同一個本機資料庫。
- **不用裝模型，也不用 API key**：背景存對話是純程式在搬資料，不花 AI 額度；需要動腦的事交給你手上的 Claude Code 或 Codex。
- **個人用、團隊用都可以**：沒設定團隊文件庫就是個人模式；設定之後，文件跟決策卡片會經過審核跟 PR 分享給全隊。

> 介面訊息（setup 的檢查結果、本機審核頁、部分指令的輸出）目前是繁體中文。
> 日文、韓文用的是同一套切法，理論上適用，但沒有實測過。

圖解版（一頁看完整個設計）：[完整版](https://bill-lin.dev/dev-memory/design.html)、[精簡版](https://bill-lin.dev/dev-memory/overview.html)。

---

## 它怎麼運作

兩條路同時在跑：

```
背景（完全自動）
  每講完一回合 → 對話存進 ~/.dev-memory/memory.db → 之後搜得到

你的動線（需要時才發生）
  做了決定     → AI 提議存成一張卡片（原因、決定、放棄了什麼）→ 你點頭才存
  「寫一份文件」→ AI 讀程式碼 → ① 先給你看大綱 → 寫成文件 → ② 本機審核頁 → 你按「送出 PR」
```

| 名詞 | 是什麼 | 誰寫 | 放在哪 |
|---|---|---|---|
| 對話 | 你跟 AI 講過的話，原始素材 | 自動收 | 只在你的電腦 |
| 卡片 | 一個決定濃縮成三行：原因、決定、放棄了什麼 | AI 起草，你確認 | 本機；團隊模式下隨文件一起送 PR |
| 文件 | 給人讀的規格，一個主題一份 | AI 讀程式碼寫，你在審核頁核准 | 團隊文件庫 |

查東西的時候，AI 先看文件，不夠再看卡片，最後才翻原始對話。寫文件的時候，**事實一律從程式碼讀**，卡片跟對話只拿來寫「設計考量」跟「Known Issue」。
因為對話裡記的常常是當初的提案，不是最後的實作。

---

## 需求

| 需要 | 說明 |
|---|---|
| [Bun](https://bun.sh) 1.3 以上 | hook、MCP server、CLI 都用 `bun` 啟動，**必須在 PATH 裡**。開發用的是 1.3.4 |
| 有 FTS5 的 SQLite | macOS 內建的就有（測過 3.51）；Linux 上 Bun 自帶的也有 |
| Claude Code 或 Codex CLI | 兩個都裝也可以，會共用同一份記憶 |
| git、[gh](https://cli.github.com)（已登入） | **團隊模式才需要**：開 PR、查 PR 狀態 |

主要在 macOS 上開發跟使用；Linux 上 CI 會跑完整測試；Windows 沒有測過。

---

## 安裝

### Claude Code

```bash
claude plugin marketplace add xinqilin/dev-memory
claude plugin install dev-memory@dev-memory
```

裝完**重開 Claude Code** 才會生效。確認一下：

```bash
claude plugin details dev-memory    # 列出 skill、hook、MCP，以及每個 session 的常駐 token 成本
```

更新用 `claude plugin update dev-memory`，一樣要重開才生效。plugin 是**看版本號**決定要不要更新的。

### Codex CLI

> 在隔離的環境實測過安裝跟 MCP；hook 還沒在真實的 Codex session 裡驗證過。遇到問題歡迎開 issue。

```bash
git clone https://github.com/xinqilin/dev-memory.git
codex plugin marketplace add ./dev-memory
codex plugin add dev-memory@dev-memory
```

Codex 只會執行你信任過的 hook：開 session 時在 hook 審查畫面、或輸入 `/hooks`，信任 dev-memory 的 hook，然後**重開 session**。

---

## 快速上手

### 1. 讓 `dm` 指令可以用（選用）

裝好之後開一次 session，`~/.dev-memory/bin/dm`（以及同樣作用的 `dev-memory`）就會出現。每次開 session 都會重寫它，
讓它指向目前裝的版本，所以更新 plugin 之後不用改任何東西。想在終端機自己下指令的話，把它加進 PATH：

```bash
echo 'export PATH="$HOME/.dev-memory/bin:$PATH"' >> ~/.zshrc   # 然後開一個新的終端機
```

平常用不到：該跑的指令 AI 會自己跑。

### 2. 個人模式：一個指令

```bash
dm setup
```

也可以直接在對話裡說「**幫我設定 dev-memory**」。它會建好 `~/.dev-memory/`、產生設定檔、把你既有的對話灌進索引，
然後逐項檢查環境，缺什麼就直接告訴你要跑哪一行：

```
✓ bun        1.3.4  /Users/you/.bun/bin/bun
✓ git        /opt/homebrew/bin/git
✓ gh         找不到 gh（個人模式用不到）
✓ 本機索引     ~/.dev-memory  (schema v3, SQLite 3.51.0)
✓ memory repo 沒設定：個人模式，對話跟紀錄只存在本機
            要分享給團隊時再跑 dev-memory setup --repo <clone 的路徑>
✓ hook       最近 7 天沒有失敗
✓ dm 指令     /Users/you/.dev-memory/bin/dm

索引：新增 1204 筆對話

都好了（個人模式）。對話會自動存；做出決定時 AI 會提議存成卡片，你點頭才存。
```

可以重複跑，**不會覆蓋你手改過的設定**。

### 3. 團隊模式：多一個文件庫

團隊模式需要一個大家共用的 git repo 放文件跟卡片，新的或既有的都可以。

```bash
dm init-repo ~/projects/billing-docs   # 在 repo 裡補上骨架，不會覆蓋任何現有檔案
```

它會加上：

| 檔案 | 用途 |
|---|---|
| `README.md` | **唯一的索引**。沒被這裡連到的文件，等於不存在 |
| `schema.md` | 給 AI 的寫作規則：來源優先序、文件骨架、不能寫什麼。**改這份就是改 AI 的行為** |
| `repos.yaml` | 這個產品有哪些程式碼 repo、要讀哪一支分支。只寫 repo 身分，不寫任何人的本機路徑 |
| `records/` | 卡片，一人一月一個 JSONL 檔，只增不改 |
| `.github/workflows/lint.yml` | 每個 PR 都跑 gitleaks 掃機密，並檢查連結、索引跟 `records/` 格式 |

把 `repos.yaml` 填好、commit、push 之後，每個人 clone 這個 repo，再各自跑：

```bash
dm setup --repo ~/projects/billing-docs   # 指到自己的 clone
dm repos --save                           # 找出每個程式碼 repo 在自己電腦的位置，寫進設定檔
```

`dm repos` 會掃 `~/projects`、`~/src`、`~/code`、`~/work`、`~/dev` 這些常見目錄，用 git remote 比對 `repos.yaml`；
找不到的會直接印出要貼進設定檔的那一行。

個人模式隨時可以轉成團隊模式，跑一次 `dm setup --repo` 就好。**之前在其他專案存的卡片不會被整批送出**：
寫文件時只會帶上「在 `repos.yaml` 列出的 repo 裡存的卡片」。

### 4. 確認在運作

開一個新 session，問 AI：「context 裡有 dev-memory 的訊息嗎？」應該會看到 `dev-memory: N turns, M records indexed`。

---

## 平常怎麼用

**真正要你主動開口的只有一句**：「幫我寫一份〈主題〉的文件」。其他都是 AI 來問你。

| 你想做什麼 | 你說 | 背後發生什麼 |
|---|---|---|
| 查以前怎麼做的 | 「上次那個中介表怎麼決定的？」「發票怎麼拋到 ERP？」 | AI 先搜記憶（文件 → 卡片 → 原始對話），答不出來才去讀程式碼 |
| 存一個決定 | AI 提議時說「好」，或自己說「把這個決定存起來」 | 起草一張卡片給你看，你說可以才存 |
| 寫文件（團隊模式） | 「幫我寫一份 sync-invoices 的文件」 | 讀程式碼 → 給你看大綱 → 寫文件 → 打開本機審核頁 |

主題要具體：**一支批次、一條資料流、一個子系統**，不是「最近的幾個決定」。

五個 skill 會依你說的話自己被叫起來；想確定叫到某一個，就打斜線指令，例如 `/dev-memory:wiki-ingest`。

| skill | 什麼時候 | 做什麼 |
|---|---|---|
| `mem-search` | 你提到「上次、之前、那個…」、問過去的決定或專案背景 | 先搜記憶再回答，教 AI 怎麼挑中文關鍵字 |
| `mem-save` | 做出決定時 AI 主動提議，或你要它存 | 起草卡片（原因、決定、放棄），**沒給你看過的不准存** |
| `wiki-ingest` | 你說要寫文件 | 讀程式碼寫規格，開審核頁，**不會自己 push** |
| `wiki-lint` | 「幫我檢查文件」 | 壞連結、沒被索引的文件、程式碼改了但文件沒跟上 |
| `mem-setup` | 「幫我設定 dev-memory」、記錄好像停了 | 跑 `setup`，逐項修 |

AI 另外拿得到兩個 MCP 工具：`memory_search`、`memory_get`。

**只有你能做的事**：在審核頁按「核准並 commit」跟「送出 PR」。AI 不會 push，skill 也明文禁止它去碰那兩顆按鈕。

---

## 指令

平常用不到，AI 會幫你跑。除錯或想自己來的時候，用 `dm <指令>`：

| 指令 | 用途 |
|---|---|
| `setup` | **裝完先跑這個**：設定、建索引、同步、檢查環境（`--repo`、`--skip-sweep`、`--skip-sync`） |
| `search <字詞>` | 關鍵字搜尋（`--repo`、`--here`、`--kind`、`--limit`、`--json`） |
| `get <kind> <ref>` | 印出某一筆的完整內容 |
| `sweep` | 掃描兩個工具的所有對話紀錄，補上漏掉的 |
| `sync` | 從文件庫的 main 匯入卡片跟文件（`--skip-fetch`）。**PR merge 後要自己跑**；PR 被關掉沒 merge 的話，卡片會退回本機 |
| `repos` | 每個程式碼 repo 在這台電腦的哪裡（`--save` 寫進設定檔、`--product`） |
| `entities` | 卡片提到哪些資料表、API、queue，誰寫誰讀，哪些還沒有任何文件提到 |
| `lint` | 檢查壞連結、沒被 README 索引的文件、重複的標題、殘留的 frontmatter |
| `stale` | 文件最後的「程式碼位置」表列出的程式碼，在文件寫完之後有沒有改過或被搬走 |
| `eval <file.yaml>` | 用評測集量搜尋準不準（`--suggest` 從記憶生候選題目） |
| `review --branch <b>` | 開本機審核頁 |
| `publish --branch <b>` | push 並開 PR（**只有你自己能跑**） |
| `ingest-discard --branch <b>` | 整份文件不要了：卡片退回本機、刪工作區跟分支。PR 還開著的不動，已關閉的可以清 |
| `init-repo <dir>` | 把文件庫的骨架加進既有 repo，不覆蓋任何現有檔案 |
| `index-docs` | 把 repo 原本就有的人工文件補進 README 索引（接手既有文件庫時用） |
| `archive` · `init` · `record` · `export` · `ingest-start` | hook 跟 skill 內部用的 |

---

## 設定檔

`~/.dev-memory/config.toml`，第一次跑 `setup` 時產生：

```toml
[embedding]
provider = "none"          # 目前只有 none 有作用；語意搜尋還沒做

[memory]
repo = ""                  # 團隊文件庫的 clone；空的就是個人模式
branch = "main"

[repos]                    # 每個程式碼 repo 在你電腦的位置，dm repos --save 會幫你填
"acme/billing-api" = "~/projects/billing-api"

[capture]
exclude = []               # 這些目錄裡的對話不收，例如 ["~/personal", "~/projects/customer-x"]
```

---

## 隱私與資料放在哪

| 東西 | 放哪 | 誰看得到 |
|---|---|---|
| 原始對話 | `~/.dev-memory/memory.db` | **只有你**，永遠不會提交 |
| 設定、程式碼的本機路徑 | `~/.dev-memory/config.toml` | **只有你** |
| hook 的錯誤紀錄 | `~/.dev-memory/hook.log` | **只有你** |
| 卡片 | 本機；團隊模式下送進文件庫的 `records/` | 個人模式只有你；團隊模式是有 repo 權限的人 |
| 文件 | 團隊文件庫 | 有 repo 權限的人 |

**plugin 本身不用任何帳密**：設定檔只有路徑跟搜尋模式，GitHub 用你原本的 `gh` 或 SSH 登入。個人模式平常不會連網。
要小心的是**對話內容**：你貼過的 token、連線字串會跟著對話被收進來。所以：

- **收進來之前先遮掉**：AWS key、GitHub／Slack token、私鑰、`password = "..."`、URL 裡的帳密，存進去的是 `[REDACTED:種類]`。
  會有誤遮，寧可多遮。
- **整個目錄不收**：客戶的程式、私人專案，寫進設定檔的 `[capture] exclude`。路徑照字面比對，大小寫要跟實際一樣。
  只影響之後的對話；已經收進來的不會刪。
- **收的只有你打的字跟 AI 回的文字**，工具的輸出跟 AI 的 thinking 本來就不收。
- **要送給團隊的東西擋兩次**：本機審核頁掃到疑似金鑰就不給核准，文件庫的 CI 再用 gitleaks 掃一次。

**`memory.db` 要備份。** Claude Code 預設 30 天就刪掉原始對話檔，之後舊對話只剩這一份；個人模式的卡片也只存在這裡。
放進 Time Machine，或定期跑 `sqlite3 ~/.dev-memory/memory.db ".backup <備份路徑>"`。不要為了「重建」刪掉它。

---

## 卡住的時候

| 症狀 | 原因 | 怎麼辦 |
|---|---|---|
| 完全沒在記錄 | `bun` 不在 PATH，hook 起不來 | `which bun`；從圖形介面啟動的工具可能拿不到 shell 的 PATH，改從終端機啟動試試 |
| 記錄有時斷掉 | hook 出錯被吞掉了（它不能讓你的對話中斷） | `dm setup` 的 `hook` 那行會列出最近 7 天的失敗；完整紀錄在 `~/.dev-memory/hook.log` |
| Codex 沒在記錄 | hook 沒被信任 | 在 Codex 輸入 `/hooks` 信任 dev-memory 的 hook，然後重開 session |
| 找不到 `dm` | 還沒開過 session，或 `~/.dev-memory/bin` 不在 PATH | 開一次 Claude Code／Codex，再照〈快速上手〉第 1 步加進 PATH |
| `plugin update` 說已經是最新版 | 更新是看版本號決定的 | 版本號沒變就代表還沒有新版 |
| 搜不到明明討論過的東西 | 說法差太多，或那段對話還沒收進來 | 換個說法再問一次；`dm sweep` 補收；`dm search <詞> --json` 看實際命中 |
| 寫文件時說找不到程式碼 | 設定檔的 `[repos]` 沒有那個 repo | `dm repos --save`；掃不到的它會印出要貼的那一行 |
| 文件寫出來跟實際行為不符 | 讀到的分支不對 | 看 `repos.yaml` 的 `refs`：有的 repo `dev` 比 `main` 新，有的相反 |
| merge 了卻搜不到新文件 | 還沒 `sync` | `dm sync`。開 session 時自動做的是補收對話，不是拉團隊文件 |
| PR 在 GitHub 上關掉、沒有 merge | 那次送出的卡片卡在「已送出」 | `dm sync` 會發現並把卡片退回本機；工作區用 `dm ingest-discard --branch <b>` 清掉 |
| 審核頁「核准」按不下去 | 有檢查沒過 | 看「檢查結果」分頁，點檔名跳過去修 |
| 「送出 PR」是灰的 | 還沒 commit | 先按「核准並 commit」 |
| `stale` 說查不到 | 那個程式碼 repo 沒 clone 在這台電腦，或本機沒有表上寫的分支 | `dm repos` 看要補哪一行；分支沒有就先 `git fetch` |

---

## 常見問題

**跟其他 AI 記憶工具差在哪？**
很多工具用 SQLite FTS5 預設的斷詞，它不會切中文，所以中文對話幾乎搜不到；也有工具用 AI 把每一步摘要成英文，成本高，
而且摘要時可能把決定漏掉。dev-memory 存的是原文，先切好中文再建索引，背景不花任何 AI 額度，另外多了「讀程式碼寫文件、
經過審核送 PR」這條團隊流程。如果你只用英文、想要全自動的摘要，其他工具可能更適合你。

**為什麼沒有用 embedding（語意搜尋）？**
搜尋結果是給 AI 看的，換個說法重搜這件事 AI 自己就會做；要搜的大多是程式識別字，這正是關鍵字排序（bm25）的強項；
而且不用每個人多跑一個模型服務。搜不到的時候，也查得出是哪個詞沒對上。之後真的需要，可以再加上關鍵字跟語意兩種排序的融合，
資料不用重收。完整的理由在[圖解完整版](https://bill-lin.dev/dev-memory/design.html)。

**為什麼用 SQLite，不用 PostgreSQL？**
資料是每個人自己的，共享走 git；SQLite 就是一個檔案，FTS5 內建全文檢索，不用多開一個服務。

**會把我的程式碼或對話送去哪裡嗎？**
plugin 自己不會。個人模式平常不會連網（只有 `setup` 會用 gh 確認登入狀態）；團隊模式只會用 git 跟 gh 操作你的文件庫。AI 的部分就是你原本在用的 Claude Code 或 Codex。

**會多花多少 AI 額度？**
背景存對話不花。每個 session 常駐約 300 多 token：五個 skill 各一兩行說明（讓 AI 知道什麼時候該叫它），
加上 session 開頭一小段說明。寫文件的花費就跟一般對話一樣，主要看讀了多少程式碼。

**可以改 AI 寫文件的方式嗎？**
可以，改文件庫裡的 `schema.md` 就好，不用改程式，也不用等新版。

---

## 目前狀態

| | |
|---|---|
| 可以用 | 自動收對話、中文搜尋、存卡片、個人模式、讀程式碼寫文件、本機審核頁、送 PR、lint、文件過時偵測 |
| 實際用過 | 在 Claude Code 上端對端跑過兩次真實的文件 PR |
| 還沒驗證 | Codex 的 hook 在真實 session 裡的表現；Windows；日文、韓文 |
| 還沒做 | 語意搜尋；評測集目前只有 5 題範例 |

---

## 開發

```bash
git clone https://github.com/xinqilin/dev-memory.git
cd dev-memory/plugins/dev-memory
bun install
bun test            # 191 個測試
bun run build       # 改了 src/ 要重新打包 dist/
```

用本機的版本測試：`claude --plugin-dir ./plugins/dev-memory`，或 `claude plugin marketplace add <clone 的路徑>`。

```
.claude-plugin/marketplace.json     # Claude Code 的 marketplace
.agents/plugins/marketplace.json    # Codex 的 marketplace
plugins/dev-memory/
├── .claude-plugin/plugin.json      # Claude Code 讀這份
├── plugin.json                     # Codex 讀這份
├── .mcp.json / mcp.json            # Claude Code 只讀前者，Codex 只讀後者，兩份都要留
├── hooks/hooks.json                # 兩邊共用：SessionStart 補收對話、Stop 每回合增量存檔
├── skills/                         # mem-search、mem-save、mem-setup、wiki-ingest、wiki-lint
├── src/
│   ├── cli.ts                      # 所有功能的入口
│   ├── mcp-server.ts               # memory_search / memory_get
│   ├── hooks/                      # session-start、stop
│   ├── adapters/                   # 兩個工具的對話紀錄 → 同一種格式
│   ├── review/                     # 本機審核頁
│   └── core/                       # 資料庫、斷詞、搜尋、同步、worktree、lint…
├── dist/                           # 打包好的 MCP server 跟審核頁，要 commit 進 repo
└── test/
templates/memory-repo/              # init-repo 會複製到文件庫的骨架
```

**發版**：把 `plugin.json`、`.claude-plugin/plugin.json`、`package.json` 三個版本號一起改 → `bun run build`
（MCP server 會帶版本號，所以要在改完版本之後）→ `bun test` → commit。版本號沒變，使用者的 `plugin update` 就拉不到新版。

CI（`.github/workflows/test.yml`）每次 push 都會跑全部測試，並檢查 `dist/` 有沒有跟上原始碼。

**幾條規則**：

- skill 裡不能寫死任何一個工具專屬的 tool 名稱，因為要同時支援兩個工具
- 使用者資料一律放 `~/.dev-memory/`
- 記憶、對話、真實資料**絕對不能進這個 repo**：plugin 會整包複製到每個安裝者的電腦
- `dist/` 要 commit：從 git 安裝的人不會有 `node_modules`
- plugin 不自己安裝任何軟體

---

## 授權

[Apache-2.0](LICENSE)
