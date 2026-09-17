# Phase 0 Spike 結果 — 2026-09-18

## 結論總表

| 步驟 | 結果 | 證據等級 |
|---|---|---|
| 0.1 repo 基礎 | 完成。`.git` 原本就在（`master`、零 commit），不用再 `git init`；全域 gitignore 會擋掉指引檔，已在 repo `.gitignore` 加例外 | 實測 |
| 0.2 hello plugin | 完成。Claude Code `claude plugin validate` 通過（含 `--strict`）；Codex 在隔離的 `CODEX_HOME` 裡能加入 marketplace、安裝 plugin，也看得到 skill 跟 MCP server | 實測（工具內的完整 session 待你跑，見最後一節） |
| 0.3a hooks.json 能否共用 | **文件層面可以共用，待 session 實測**。兩邊格式相同，Codex 也會提供 `CLAUDE_PLUGIN_ROOT` 別名；但 Codex 文件沒寫 hook command 是否透過 shell 執行 | 文件＋待實測 |
| 0.3b Codex plugin 能否帶本機 stdio MCP | **可以**。`codex mcp list` 列出 plugin 的 stdio server，`${PLUGIN_ROOT}` 已展開 | 實測 |
| 0.4 bun:sqlite FTS5 | **可以**。macOS arm64 用系統 SQLite 3.51.0，`ENABLE_FTS5` 有開 | 實測 |
| 0.5 tokenize.ts | **通過**。6 個中文詞 MATCH 筆數全部等於 LIKE 筆數；`WAIT_FOR_INSERT_MIDDLE_DB` 找得到 | 實測 |
| 0.6 repo-id.ts | **通過**。ssh／https／worktree／Codex `session_meta` 都轉成同一個 ID；另外拿本機 30 份真實 rollout 驗證也全部一致 | 實測 |

`bun test`：**32 pass / 0 fail**（6 個檔案，2.03 秒）。

## 0.1 repo 基礎

- `~/.gitignore_global` 忽略 `CLAUDE.md`、`AGENTS.md`、`HANDOFF.md`、`.claude/`。不處理的話，這三個指引檔不會進 repo，隊友 clone 下來兩個工具都讀不到。
- 做法：repo `.gitignore` 加 `!AGENTS.md`、`!CLAUDE.md`、`!docs/HANDOFF.md`。repo 層級的規則優先於 `core.excludesFile`，`git check-ignore -v` 確認生效。
- `.claude/`（目前只有 `.cc-writes`）照樣忽略。
- 另外排除：`node_modules/`、`.DS_Store`、`*.db*`、`*.sqlite*`、`*.jsonl`、`.env*`。Phase 1 加 transcript fixture 時，要替 fixture 目錄加例外。

## 0.2 hello plugin

```
.claude-plugin/marketplace.json        # Claude Code（name: project-plugin）
.agents/plugins/marketplace.json       # Codex（source.source = "local"）
plugins/dev-memory/
  .claude-plugin/plugin.json           # Claude Code 讀
  plugin.json                          # Codex 讀（Agent Plugins 1.0.0 $schema）
  .mcp.json                            # Claude Code 讀，args 用 ${CLAUDE_PLUGIN_ROOT}
  mcp.json                             # Codex 讀，必須有 type: "stdio"，args 用 ${PLUGIN_ROOT}
  hooks/hooks.json                     # 兩邊共用（待 session 實測）
  skills/hello/SKILL.md                # 兩邊共用，不寫死工具專屬 tool 名稱
  src/hello-hook.ts                    # 輸出 additionalContext，並把證據寫進 ~/.dev-memory/logs/hello-hook.log
  src/hello-mcp.ts                     # 零依賴 stdio JSON-RPC，一個 hello tool
  test/hello-{hook,mcp}.test.ts
```

- **MCP server 沒有用 SDK**：Codex 安裝時會把 plugin 複製到 cache（見下方），git 來源的 marketplace 不會有 `node_modules`。hello 階段先用零依賴，把「Codex 能不能帶 stdio MCP」這個變數獨立出來。
- **marketplace description**：`claude plugin validate .` 原本警告缺 description，加上 `metadata.description` 後 `--strict` 通過。

### Claude Code 靜態驗證
```
$ claude plugin validate ./plugins/dev-memory --strict   → ✔ Validation passed
$ claude plugin validate . --strict                      → ✔ Validation passed
```

## 0.3 相容性驗證

### 方法
指令都在隔離的 `CODEX_HOME=$TMPDIR/codex-home` 裡跑，**沒有動到 `~/.codex`**。

### Codex 實測紀錄
```
$ codex plugin marketplace add ./
Added marketplace `project-plugin` from /Users/bill.lin/project-plugin.
$ codex plugin list
dev-memory@project-plugin  not installed           /Users/bill.lin/project-plugin/plugins/dev-memory
$ codex plugin add dev-memory@project-plugin
Added plugin `dev-memory` from marketplace `project-plugin`.
Installed plugin root: $CODEX_HOME/plugins/cache/project-plugin/dev-memory/0.0.1
$ codex mcp list
dev-memory  bun  $CODEX_HOME/plugins/cache/.../0.0.1/src/hello-mcp.ts  PLUGIN_DATA=*****, PLUGIN_ROOT=*****  enabled
$ codex debug prompt-input "hello"
... - dev-memory:hello: Phase 0 smoke test for the dev-memory plugin. ... (file: r2/dev-memory/0.0.1/skills/hello/SKILL.md)
```

### 發現
1. **Codex 讀 marketplace 的順序**：用的是 `.agents/plugins/marketplace.json`（`codex plugin list` 會印出路徑）。
2. **Codex 安裝分兩步**：`marketplace add` 之後還要 `plugin add <plugin>@<marketplace>`。安裝時會把 plugin **複製**到 `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/`，所以 plugin root 是複本，不是原始碼目錄。
3. **Codex 只讀 `mcp.json`，不讀 `.mcp.json`**。對照實驗：把 cache 裡兩份檔案的 server 分別改名成 `dm-from-mcp-json`、`dm-from-dot-mcp-json`，`codex mcp list` 只出現前者；拿掉 `mcp.json` 後就顯示「No MCP servers configured」。→ **兩份 MCP 設定都必須保留**，符合 PLAN。
4. **Agent Plugins 1.0.0 規格（§7.2、§9.2）**：
   - `command` 必須是單一 token，**不做變數展開**。
   - `args`、`env`、`cwd` 會展開 `${PLUGIN_ROOT}`、`${PLUGIN_DATA}`。
   - `cwd` 預設是 plugin root。
   - 裸指令名稱（例如 `bun`）怎麼透過 PATH 找到由 client 決定。→ **使用者的 PATH 裡必須有 `bun`**，要寫進 README。
   - hooks 不在 Agent Plugins v1 範圍內，屬於各工具自己的格式。
5. **Codex skill 名稱**：`dev-memory:hello`（debug prompt-input 可見），跟 Claude Code 的 `/dev-memory:hello` 命名空間一致。
6. **Hook 信任**：Codex binary 裡有 `bypass_hook_trust` 設定。在隔離環境加上後，`debug prompt-input` 仍然不會觸發 SessionStart hook，所以 hook 只能在真的 session 裡驗證。
7. `codex features list`：`hooks` stable/true、`plugins` stable/true；`plugin_hooks` 標為 `removed`（推測是已經畢業、不再需要 flag，**未證實**）。

### hooks.json 能否共用：證據
| 項目 | Claude Code | Codex |
|---|---|---|
| 檔案位置 | `hooks/hooks.json`（預設） | `hooks/hooks.json`（預設，可用 manifest 覆寫） |
| 格式 | `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":...}]}]}}` | 同上（官方範例同結構） |
| `matcher` 可省略 | 可 | 可 |
| SessionStart 輸出 | 純文字或 `hookSpecificOutput.additionalContext` | 同上 |
| `CLAUDE_PLUGIN_ROOT` | 會替換，也會設成環境變數；command 透過 `sh -c` 執行 | 設成環境變數（`PLUGIN_ROOT` 的相容別名）；**是否透過 shell 執行文件沒寫** |

→ 結論：**格式可共用**。唯一的不確定點是 Codex 會不會用 shell 展開 command 字串裡的 `${CLAUDE_PLUGIN_ROOT}`。
→ 實測失敗時的退路（照 PLAN 拆兩份）：保留 `hooks/hooks.json` 給 Claude Code，另寫 `hooks/codex-hooks.json` 改用 `${PLUGIN_ROOT}`，並在 `plugin.json` 加 `extensions."com.openai".hooks = "./hooks/codex-hooks.json"`。

## 0.4 bun:sqlite FTS5

```
sqlite_version=3.51.0 platform=darwin/arm64 ENABLE_FTS5=true
```
- **修正 HANDOFF 的說法**：Bun 在 macOS 預設用系統的 `libsqlite3.dylib`（Bun 文件：node-compat / sqlite），不是 Bun 自帶的 SQLite。「Bun build flag 有開 FTS5」只適用 Linux/Windows。macOS 這次實測 Apple 版有 FTS5，但舊版 macOS 或 Linux 隊友要在 `dev-memory init` 時檢查 `compile_options`。

## 0.5 tokenize.ts

### 設計
- FTS5 表：`tokenize = "unicode61 tokenchars '_'"`，讓 `_` 不當分隔符。
- 建索引（`tokenizeForIndex`）：
  - CJK（Han／Hiragana／Katakana／Hangul）連續段 → 重疊 bigram；只有一個字時保留單字。
  - 識別字 → 小寫完整形式，再加上 camelCase／snake_case 拆出來的部分（`sapStatus` → `sapstatus sap status`）。
- 查詢（`buildMatchQuery`）：
  - CJK 段 → bigram phrase（`"例外 外處 處理"`，強制相鄰，語意等於子字串）。
  - 識別字 → 加引號的完整 token；各 term 之間是 AND。
  - 單一個 CJK 字 → `"例"*` prefix。**已知限制**：找不到出現在連續段最後一個字的單字。

### 實測（claude-mem.db 唯讀，欄位 title/subtitle/narrative/text/facts/concepts）
| 查詢 | LIKE | bigram MATCH | 原本 unicode61 MATCH |
|---|---|---|---|
| 例外 | 12 | **12** | 3 |
| 例外處理 | 7 | **7** | 2 |
| 資料 | 151 | **151** | 1 |
| 排程 | 6 | **6** | 2 |
| 決策 | 25 | **25** | 0 |
| 測試 | 71 | **71** | 13 |
| WAIT_FOR_INSERT_MIDDLE_DB | 16 | **16** | 16 |

- 資料量：4,124 筆，建索引（含 tokenize）1.1–1.9 秒。
- **筆數會漂移**：PLAN 記的是 4,069 筆、`例外` 10 筆，這次測試期間從 4,109 長到 4,124 筆，`例外` 從 11 變 12。原因是 claude-mem 還在記錄（包括這次 session）。所以測試斷言的是「MATCH 筆數 = LIKE 筆數」，不寫死數字。
- **識別字**：原本的 unicode61 把 `WAIT_FOR_INSERT_MIDDLE_DB` 當成 phrase `wait for insert middle db`，所以一樣找得到 16 筆。`tokenchars '_'` 真正的差別在精準度：查 `WAIT_FOR_INSERT` 不會誤中 `WAIT_FOR_INSERT_MIDDLE_DB`（單元測試 `full identifier does not match its prefix`）。
- 整合測試在沒有 `~/.claude-mem/claude-mem.db` 的機器上會自動 skip；可以用 `CLAUDE_MEM_DB` 指定路徑。真實資料不進 repo。

## 0.6 repo-id.ts

- `normalizeRemote`：scp 式 ssh（含 host alias，例如 `git@github-work:`）、`ssh://`（含 port）、https（含 `user@`、結尾 `/`、`.git`）→ `owner/repo`。
- `repoIdFromDir`：`git -C <dir> remote get-url origin`。worktree 共用主 repo 的 config，所以結果相同；不在 git 裡、或沒有 origin → `null`。
- `repoIdFromCodexSessionMeta`：讀 rollout 第一行 `type = "session_meta"` 的 `payload.git.repository_url`。
- 測試：17 個，全部用合成的 `example-org/example-repo`；worktree 在 tmpdir 建臨時 repo 加 `git worktree add`。
- **真實資料健全性檢查**（本機唯讀、不 commit）：30 份 Codex rollout 裡有 27 份帶 `repository_url`，27 份全部轉換成功，共 7 個不同的 repo；其中 25 份的 cwd 還存在，用 `repoIdFromDir(cwd)` 取得的 ID **25/25 一致**。

## 要改計畫的地方（已同步到 PLAN.md）

1. 相容性表的 MCP 列：Codex 只讀 `mcp.json`，要有 `type: "stdio"`；`command` 不展開變數，`args` 展開 `${PLUGIN_ROOT}`。
2. 相容性表新增「安裝」列：Codex 分兩步，而且會複製到 cache。
3. 應用程式表的 Bun 列：macOS 用系統 SQLite，`init` 時要檢查 FTS5。
4. 資料格式的 `fts` 列：`unicode61 tokenchars '_'`、bigram phrase 查詢、單字限制。
5. Phase 0 步驟 5 的數字改成「MATCH = LIKE」，不寫死筆數。
6. 風險：plugin 的 hook／MCP 依賴 PATH 裡有 `bun`；git 來源的 marketplace 沒有 `node_modules` → Phase 1 的 MCP server 要嘛零依賴、要嘛打包成單檔。

## 需要你決定

1. **repo ID 規則**：目前統一小寫並去掉 host（GitHub 不分大小寫，SSH host alias 也能對上）。代價是不同 host 上的同名 `owner/repo` 會被當成同一個 repo，104corp 只用 GitHub 的話沒影響。要不要保留 host？
2. **Phase 1 MCP server 怎麼散佈**：(a) 用 `@modelcontextprotocol/sdk`，`bun build` 打包成單檔再 commit；(b) 維持零依賴手寫 JSON-RPC。建議 (a)，因為 Phase 1 要 `memory_search`／`memory_get`，還要處理 schema 驗證。
3. **私有 marketplace 安裝**（HANDOFF Next Steps 提到的）：要先 push 到 GitHub 私有 repo 才能驗證，這次沒做。

## 待你執行：工具內驗證

> 下面的 Codex 指令會寫入 `~/.codex/config.toml`，所以由你自己執行。

### Claude Code
```bash
cd /Users/bill.lin/project-plugin
claude --plugin-dir ./plugins/dev-memory
```
| 在 session 裡做 | 預期 |
|---|---|
| 問：「context 裡有 DEV_MEMORY_HOOK_OK 嗎？原文貼出來」 | `DEV_MEMORY_HOOK_OK host=claude-code source=startup` |
| `/mcp` | `plugin:dev-memory:dev-memory` 狀態是 connected |
| `/dev-memory:hello` | 先回 `DEV_MEMORY_SKILL_OK`，再呼叫 MCP，回 `DEV_MEMORY_MCP_OK hello ... (host=claude-code, bun=1.3.4, cwd=...)` |
| 另開終端機：`tail -1 ~/.dev-memory/logs/hello-hook.log` | `"host":"claude-code"`、`transcript_path_is_null:false` |

### Codex CLI
```bash
cd /Users/bill.lin/project-plugin
codex plugin marketplace add ./                 # 預期：Added marketplace `project-plugin`
codex plugin add dev-memory@project-plugin      # 預期：Added plugin `dev-memory` ... Installed plugin root: ~/.codex/plugins/cache/project-plugin/dev-memory/0.0.1
codex mcp list                                  # 預期：dev-memory  bun  .../src/hello-mcp.ts  enabled
codex                                           # 開 session
```
| 在 session 裡做 | 預期 |
|---|---|
| **啟動時的 hook 審查畫面，或輸入 `/hooks`，信任 dev-memory 的 SessionStart hook**，然後**重開** session | 信任後才會執行 |
| 問：「context 裡有 DEV_MEMORY_HOOK_OK 嗎？原文貼出來」 | `DEV_MEMORY_HOOK_OK host=codex source=startup` → **hooks.json 共用成立** |
| 另開終端機：`tail -1 ~/.dev-memory/logs/hello-hook.log` | `"host":"codex"`，`env.CLAUDE_PLUGIN_ROOT` 不是 null；另外記下 `transcript_path_is_null` 的值 |
| 說「用 dev-memory 的 hello skill」 | `DEV_MEMORY_SKILL_OK`，接著是 `DEV_MEMORY_MCP_OK hello ... (host=codex, ...)` |

- **hook 沒輸出**：`~/.dev-memory/logs/hello-hook.log` 沒有新增 codex 那一行，代表 `${CLAUDE_PLUGIN_ROOT}` 沒被展開。這時照上面「退路」拆成兩份。
- **測完清掉**：`codex plugin remove dev-memory@project-plugin`、`codex plugin marketplace remove project-plugin`。

## 來源
- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Codex plugins build: https://developers.openai.com/codex/plugins/build
- Codex hooks: https://learn.chatgpt.com/docs/hooks
- Agent Plugins 1.0.0 spec: https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md
- Agent Plugins schemas: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json、https://agent-plugins.org/schemas/1.0.0/mcp.schema.json
- MCP spec 2025-11-25（lifecycle、tools、stdio transport）: https://modelcontextprotocol.io/specification/2025-11-25
- Bun SQLite: https://github.com/oven-sh/bun/blob/main/docs/runtime/sqlite.mdx
