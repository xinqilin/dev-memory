# dev-memory

Claude Code 與 Codex CLI 共用的團隊開發記憶 plugin，搭配由 LLM 維護的 wiki。這個 repo 本身也是 plugin 的 marketplace。

**目前狀態：Phase 0（spike）。** 裡面只有一個 hello plugin 跟三個核心模組（FTS5、中文斷詞、repo ID），還不能實際蒐集記憶。完整規劃看 [docs/PLAN.md](docs/PLAN.md)，進度跟決策看 [docs/HANDOFF.md](docs/HANDOFF.md)，Phase 0 的實測結果看 [docs/spikes/phase-0.md](docs/spikes/phase-0.md)。

## 前置需求

| 需求 | 說明 |
|---|---|
| [Bun](https://bun.sh) | `brew install bun`。**`bun` 必須在 PATH 裡**，hook 跟 MCP server 都是用 `bun` 啟動的；GUI 啟動的工具如果拿不到 shell 的 PATH 會整個不動 |
| git | 一般安裝即可 |
| `gh auth login` | 之後提交記憶、開 PR 用，Phase 0 還用不到 |

## 安裝

### Claude Code

開發時直接指定本機目錄：

```bash
claude --plugin-dir ./plugins/dev-memory
```

從 marketplace 安裝：

```bash
claude plugin marketplace add git@github.com:xinqilin/dev-memory.git
claude plugin install dev-memory@project-plugin
```

### Codex CLI

```bash
codex plugin marketplace add ./          # 或 git@github.com:xinqilin/dev-memory.git
codex plugin add dev-memory@project-plugin
codex mcp list                            # 應該看得到 dev-memory
codex
```

**Codex 的 hook 要手動信任才會執行。** 啟動時會出現 hook 審查畫面，或輸入 `/hooks` 信任 dev-memory 的 SessionStart hook，信任完要重開 session。

## 確認裝好了

| 檢查 | 怎麼看 | 預期 |
|---|---|---|
| Hook | 問 AI：「context 裡有 DEV_MEMORY_HOOK_OK 嗎？」 | `DEV_MEMORY_HOOK_OK host=claude-code`（Codex 則是 `host=codex`） |
| Skill | Claude Code 打 `/dev-memory:hello`；Codex 說「用 dev-memory 的 hello skill」 | 回 `DEV_MEMORY_SKILL_OK` |
| MCP | 同上，skill 會呼叫 `hello` tool | 回 `DEV_MEMORY_MCP_OK hello ...` |

hook 每次執行都會在 `~/.dev-memory/logs/hello-hook.log` 附加一行證據（host、事件、環境變數），可以用 `tail -1` 確認。

## 資料放在哪

所有使用者資料一律在 `~/.dev-memory/`，不在 plugin 目錄裡，也不會進這個 repo。記憶的正本在另一個 memory repo，透過 PR 提交；本機的 SQLite 只是索引，刪掉可以重建。

## 開發

```bash
cd plugins/dev-memory
bun test          # 目前 32 個測試
```

```
plugins/dev-memory/
├── .claude-plugin/plugin.json   # Claude Code 讀這份
├── plugin.json                  # Codex 讀這份（Agent Plugins 1.0.0）
├── .mcp.json                    # Claude Code 讀這份
├── mcp.json                     # Codex 只讀這份，不讀 .mcp.json
├── hooks/hooks.json             # 兩邊共用
├── skills/hello/SKILL.md
├── src/core/{tokenize,repo-id}.ts
└── test/
```

兩份 MCP 設定不能刪掉任何一份：Claude Code 只讀 `.mcp.json`，Codex 只讀 `mcp.json`（Phase 0 實測，見 spike 文件）。Skill 的內容不能寫死任何一個工具專屬的 tool 名稱。

## 注意

私有 repo，公司內部使用。`git push` 一律由使用者自己執行。
