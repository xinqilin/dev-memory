---
name: mem-setup
description: Set up dev-memory on this machine after installing the plugin, or check why it is not working. Use when the user just installed it, asks how to start, or says the memory is not recording or searching.
---

# Set up dev-memory

Installing the plugin is enough to start: conversations are collected and searchable on this machine
right away. A team repo is optional — without one the memory is personal and nothing is ever
submitted. This skill walks both, and is also the first thing to run when something stopped working.

Let `CLI` mean `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts"`.

## 1. Run the check

```bash
CLI setup
```

It reports each thing it needs and, for anything missing, the exact command that fixes it. Read the
output back to the user in their language and do the parts you can do safely.

## 2. What it checks, and who fixes it

| 檢查 | 誰來修 |
|---|---|
| `bun` 在 PATH | **使用者**：`brew install bun`。plugin 不會自己安裝軟體 |
| `git`、`gh` 已登入 | **使用者**：`gh auth login`。個人模式用不到 `gh` |
| 本機索引可用（SQLite 有 FTS5） | 自動建立；沒有 FTS5 的話中文搜尋無法運作，要換一個 SQLite |
| memory repo 的位置 | 選配。沒設定就是個人模式；要分享給團隊時，**使用者先 clone**，然後你幫他跑 `CLI setup --repo <clone 的路徑>` |
| repo 結構（`schema.md`、`README.md`、`records/`） | 缺的話跑 `CLI init-repo <repo>`，然後請使用者 commit 並 push |
| hook 最近 7 天有沒有失敗 | 讀 `~/.dev-memory/hook.log` 最後幾行，照錯誤訊息處理；hook 失敗不會中斷對話，只會漏收 |
| `dm` 指令 | 每次開 session 會寫在 `~/.dev-memory/bin/`。使用者想自己下指令，才需要照 setup 印的那行加進 PATH |

## 3. Point it at the memory repo (optional)

Skip this for personal use. Ask whether they want to share with a team; only then:

If the user has not cloned it yet, give them the command and wait — cloning into a place you picked
is not your call:

```bash
git clone <團隊 memory repo 的網址> ~/<他選的位置>
```

Then:

```bash
CLI setup --repo ~/<那個位置>
```

That writes the path into `~/.dev-memory/config.toml`, sweeps the existing conversations into the
index, and syncs whatever is already on `main`.

## 4. Confirm it is working

```bash
CLI search <一個他最近討論過的詞>
```

Hits mean the collection worked. Then tell them there is nothing to remember to do: conversations
are stored on their own, and when a decision is made the AI offers to save it as a card with the
mem-save skill, which is kept only if they say yes. Asking for it themselves is only for a decision
the AI did not notice.

## Back up the database

`~/.dev-memory/memory.db` is the only copy of old conversations (Claude Code deletes its own
transcripts after 30 days by default) and, in personal mode, of every record. Tell the user to keep it in
Time Machine or copy it with `sqlite3 ~/.dev-memory/memory.db ".backup <path>"`. Never delete it
to "rebuild" the index.

## Privacy

The plugin holds no credentials; the risk is what people paste into conversations. Strings that look
like keys, tokens or passwords are masked before a turn is stored (only turns collected from now on).
A whole directory can be left out — a customer's code, a private project — in `config.toml`:

```toml
[capture]
exclude = ["~/project-other/customer-x"]
```

That affects what is collected from now on; it deletes nothing already stored.

## Semantic search

Off by default: keyword search needs nothing installed. Turning it on means running a local model
(Ollama), which is the user's choice and their disk space — never install it for them. That
part is not built yet.

## Notes

- Codex only runs hooks the user has trusted. If nothing is being recorded there, that is the
  first thing to check.
- `setup` is safe to re-run; it changes nothing that is already correct.
- Nothing here pushes to git.
