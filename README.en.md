# dev-memory

[繁體中文](README.md) · English

**For developers who talk to their coding agent in Chinese.** Your conversations with Claude Code and Codex CLI are kept
as a local memory that can actually be searched in Chinese. When you need documentation, the agent reads the code, writes
the spec, and fills in *why it was built this way* from the decisions you saved; you review it and open the PR yourself.

- **Chinese is searchable.** Chinese has no spaces, so a standard full-text index treats a whole sentence as one word.
  dev-memory splits it into overlapping two-character pieces plus single characters before indexing — no dictionary,
  no model. Measured on the same data, a search for 例外 ("exception") found 3 of 12 matches with SQLite's default
  tokenizer and all 12 here.
- **English and code identifiers work too.** `invoiceStatus` and `WAIT_FOR_INSERT_STAGING_DB` are kept whole and also
  split into `invoice` and `status`. Conversations that mix Chinese and English are exactly what it is built for.
- **One memory for both tools.** Claude Code and Codex CLI install the same plugin and write to the same local database.
- **No model to install, no API key.** Saving conversations is plain code moving data and costs no tokens; anything
  that needs thought is done by the Claude Code or Codex session you already have open.
- **Personal or team.** Without a team doc repo it is personal memory. With one, documents and decision cards reach
  the team through a review page and a pull request.

> **The interface is in Traditional Chinese**: setup's checks, the local review page and some command output.
> Japanese and Korean go through the same tokenizer and should work in principle, but have not been tested.

Illustrated explainers (in Chinese): the [full version](https://bill-lin.dev/dev-memory/design.html) and the
[short version](https://bill-lin.dev/dev-memory/overview.html).

---

## How it works

Two paths run side by side:

```
In the background (fully automatic)
  after every turn  → the conversation goes into ~/.dev-memory/memory.db → searchable from then on

Your part (only when you want it)
  a decision is made → the agent offers to save a card (why, what was decided, what was rejected) → saved only if you agree
  "write a doc"      → the agent reads the code → ① shows you an outline → writes it → ② local review page → you press "submit PR"
```

| Term | What it is | Who writes it | Where it lives |
|---|---|---|---|
| Conversation | What you and the agent said; raw material | Collected automatically | Your machine only |
| Card | One decision in three lines: why, what, and what was rejected | Drafted by the agent, confirmed by you | Local; in team mode it travels with a document's PR |
| Document | A spec for people to read, one per subject | Written by the agent from the code, approved by you | The team doc repo |

When looking something up, the agent reads documents first, then cards, and raw conversation last. When writing a
document, **facts come from the code**; cards and conversations only supply the design rationale and known issues,
because a conversation usually records the proposal, not what finally shipped.

---

## Requirements

| Needs | Notes |
|---|---|
| [Bun](https://bun.sh) 1.3+ | Hooks, the MCP server and the CLI all run on `bun`, which **must be on PATH**. Developed on 1.3.4 |
| SQLite with FTS5 | Built into macOS's system SQLite (tested on 3.51) and into Bun on Linux |
| Claude Code or Codex CLI | Both at once is fine; they share the memory |
| git and a logged-in [gh](https://cli.github.com) | **Team mode only**: opening PRs and checking their state |

Developed and used on macOS; the full test suite runs on Linux in CI; Windows is untested.

---

## Install

### Claude Code

```bash
claude plugin marketplace add xinqilin/dev-memory
claude plugin install dev-memory@dev-memory
```

**Restart Claude Code** afterwards. To check:

```bash
claude plugin details dev-memory    # skills, hooks, MCP server, and the per-session token cost
```

Update with `claude plugin update dev-memory` and restart again. Updates are driven by the version number.

### Codex CLI

> Installation and the MCP server were tested in an isolated environment; the hooks have not yet been verified in a
> real Codex session. Issues are welcome.

```bash
git clone https://github.com/xinqilin/dev-memory.git
codex plugin marketplace add ./dev-memory
codex plugin add dev-memory@dev-memory
```

Codex only runs hooks you have trusted: trust dev-memory's hooks on the review screen at startup or with `/hooks`,
then **start a new session**.

---

## Getting started

### 1. The `dm` command (optional)

After the first session, `~/.dev-memory/bin/dm` (and the same command as `dev-memory`) exists. It is rewritten at every
session start to point at the installed version, so updates need nothing from you. To run commands yourself, put it on
your PATH:

```bash
echo 'export PATH="$HOME/.dev-memory/bin:$PATH"' >> ~/.zshrc   # then open a new terminal
```

Day to day you will not need it: the agent runs what it needs.

### 2. Personal mode: one command

```bash
dm setup
```

Or just say "set up dev-memory" in a conversation. It creates `~/.dev-memory/` and the config file, indexes the
conversations you already have, and checks everything it depends on, printing the exact command for anything missing.
The output is in Chinese:

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

It is safe to re-run and **never overwrites a config you edited**.

### 3. Team mode: add a doc repo

Team mode needs one shared git repository for documents and cards, new or existing.

```bash
dm init-repo ~/projects/billing-docs   # adds the skeleton; never overwrites an existing file
```

It adds:

| File | Purpose |
|---|---|
| `README.md` | **The only index.** A document it does not link to might as well not exist |
| `schema.md` | Writing rules for the agent: source priority, document skeleton, what must never be written. **Editing it changes the agent's behaviour** |
| `repos.yaml` | Which code repositories the product has and which branch to read. Repository identities only, never anyone's local paths |
| `records/` | Cards, one JSONL file per author per month, append-only |
| `.github/workflows/lint.yml` | Every PR runs gitleaks for secrets and checks links, the index and the `records/` format |

Fill in `repos.yaml`, commit and push. Then everyone clones the repo and runs:

```bash
dm setup --repo ~/projects/billing-docs   # your own clone
dm repos --save                           # find each code repository on your machine and save the paths
```

`dm repos` scans common places such as `~/projects`, `~/src`, `~/code`, `~/work` and `~/dev`, matching git remotes against
`repos.yaml`; for anything it cannot find it prints the line to paste into the config.

Personal mode can become team mode at any time with `dm setup --repo`. **Cards saved in other projects are not sent in
bulk**: a document only carries cards saved in a repository that `repos.yaml` lists.

### 4. Check it is working

Start a new session and ask the agent whether it sees dev-memory in its context. It should report
`dev-memory: N turns, M records indexed`.

---

## Day to day

**There is only one thing you ever start**: asking for a document on a subject. Everything else, the agent asks you.
Talk in Chinese or English; the skills are chosen by meaning.

| You want to | You say | What happens |
|---|---|---|
| Recall how something was done | "How did we decide on the staging table last time?" | The agent searches the memory (documents → cards → conversations) before reading any code |
| Keep a decision | "Yes" when the agent offers, or "save this decision" | A card is drafted and shown to you; it is saved only if you agree |
| Write a document (team mode) | "Write a doc for sync-invoices" | Read the code → show you an outline → write it → open the local review page |

Keep the subject concrete: **one batch job, one data flow, one subsystem** — not "the last few decisions".

The five skills are triggered by what you say; to call one explicitly, use its slash command, such as
`/dev-memory:wiki-ingest`.

| Skill | When | What it does |
|---|---|---|
| `mem-search` | You refer to something discussed before, a past decision, or project background | Searches the memory before answering, and knows how to pick Chinese search terms |
| `mem-save` | A decision was made, or you ask it to remember | Drafts a card (why, what, rejected); **never saves one you have not seen** |
| `wiki-ingest` | You ask for a document | Writes the spec from the code and opens the review page; **never pushes** |
| `wiki-lint` | "Check the docs" | Broken links, documents missing from the index, documents the code has moved past |
| `mem-setup` | "Set up dev-memory", or recording seems to have stopped | Runs `setup` and fixes what it reports |

The agent also gets two MCP tools: `memory_search` and `memory_get`.

**Only you** press "approve and commit" and "submit PR" on the review page. The agent never pushes, and the skills
forbid it from touching those buttons.

---

## Commands

You rarely need these; the agent runs them. For debugging or doing it yourself, use `dm <command>`:

| Command | Purpose |
|---|---|
| `setup` | **Run this first**: configure, index, sync and check the environment (`--repo`, `--skip-sweep`, `--skip-sync`) |
| `search <words>` | Keyword search (`--repo`, `--here`, `--kind`, `--limit`, `--json`) |
| `get <kind> <ref>` | Print the full text behind a search hit |
| `sweep` | Scan both tools' transcripts and pick up anything missed |
| `sync` | Import cards and documents from the doc repo's main branch (`--skip-fetch`). **Run it after a merge**; cards from a PR closed without merging come back to local |
| `repos` | Where each code repository is on this machine (`--save` writes the config, `--product`) |
| `entities` | Tables, APIs and queues the cards mention, who writes and reads them, and which no document covers |
| `lint` | Broken links, documents missing from the README index, duplicate titles, leftover frontmatter |
| `stale` | Whether the code listed in a document's code-location table changed or moved after the document was written |
| `eval <file.yaml>` | Measure search quality against a case file (`--suggest` drafts cases from the memory) |
| `review --branch <b>` | Serve the local review page |
| `publish --branch <b>` | Push and open the PR (**only you run this**) |
| `ingest-discard --branch <b>` | Throw a document away: cards go back to local, the worktree and branch are removed. Refused while its PR is open; allowed once it is closed |
| `init-repo <dir>` | Add the doc repo skeleton to an existing repository without overwriting anything |
| `index-docs` | Add a repository's existing hand-written documents to the README index |
| `archive` · `init` · `record` · `export` · `ingest-start` | Used internally by the hooks and skills |

---

## Configuration

`~/.dev-memory/config.toml`, created by the first `setup`:

```toml
[embedding]
provider = "none"          # only "none" does anything today; semantic search is not built yet

[memory]
repo = ""                  # your clone of the team doc repo; empty means personal mode
branch = "main"

[repos]                    # where each code repository is on your machine; dm repos --save fills this in
"acme/billing-api" = "~/projects/billing-api"

[capture]
exclude = []               # conversations in these directories are never collected, e.g. ["~/personal"]
```

---

## Privacy and where data lives

| What | Where | Who can see it |
|---|---|---|
| Raw conversations | `~/.dev-memory/memory.db` | **Only you**; never committed |
| Config and local code paths | `~/.dev-memory/config.toml` | **Only you** |
| Hook error log | `~/.dev-memory/hook.log` | **Only you** |
| Cards | Local; in team mode, the doc repo's `records/` | Only you in personal mode; people with access to the repo in team mode |
| Documents | The team doc repo | People with access to the repo |

**The plugin itself holds no credentials**: the config holds paths and a search mode, and GitHub access uses your existing
`gh` login or SSH. Personal mode does not normally touch the network. What needs care is **conversation content**: a token
or connection string you pasted is collected along with the conversation. So:

- **Secrets are masked before they are stored**: AWS keys, GitHub and Slack tokens, private keys, `password = "..."` and
  credentials in URLs are stored as `[REDACTED:<kind>]`. It errs on the side of masking too much.
- **Whole directories can be left out**: a customer's code or a private project, via `[capture] exclude`. Paths are
  matched literally, so use the real path with the same capitalisation. It affects what is collected from then on and
  deletes nothing already stored.
- **Only what you typed and what the agent wrote** is collected; tool output and the agent's thinking never are.
- **Anything headed for the team is checked twice**: the review page will not approve a file with a suspected secret,
  and the doc repo's CI runs gitleaks.

**Back up `memory.db`.** Claude Code deletes its own transcripts after 30 days by default, after which this is the only
copy of older conversations; in personal mode it is also the only copy of your cards. Keep it in your backups, or run
`sqlite3 ~/.dev-memory/memory.db ".backup <path>"` from time to time. Never delete it to "rebuild".

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Nothing is recorded | `bun` is not on PATH, so the hooks cannot start | `which bun`; apps launched from the GUI may not get your shell's PATH, so try launching from a terminal |
| Recording stops now and then | A hook failed and swallowed the error (it must never break your session) | The `hook` line of `dm setup` lists failures from the last 7 days; the full log is `~/.dev-memory/hook.log` |
| Codex records nothing | Its hooks are not trusted | Trust dev-memory's hooks with `/hooks` in Codex, then start a new session |
| `dm` not found | No session has started yet, or `~/.dev-memory/bin` is not on PATH | Start Claude Code or Codex once, then add it to PATH as in step 1 |
| `plugin update` says it is up to date | Updates follow the version number | An unchanged version means there is no new release yet |
| Something you discussed cannot be found | The wording differs too much, or that conversation was not collected yet | Ask again in other words; `dm sweep`; `dm search <words> --json` shows the actual hits |
| The document step cannot find the code | That repository is missing from `[repos]` in the config | `dm repos --save`; it prints the line to paste for anything it cannot find |
| A document does not match the real behaviour | It read the wrong branch | Check `refs` in `repos.yaml`: in some repos `dev` is ahead of `main`, in others the reverse |
| A merged document cannot be found | `sync` has not run | `dm sync`. Session start only collects conversations; it never pulls team documents |
| A PR was closed on GitHub without merging | Its cards are stuck as "submitted" | `dm sync` notices and returns them to local; remove the worktree with `dm ingest-discard --branch <b>` |
| "Approve" cannot be pressed | A check failed | Open the checks tab and click the file name to jump to it |
| "Submit PR" is greyed out | Nothing is committed yet | Press "approve and commit" first |
| `stale` cannot check a document | That code repository is not cloned here, or the branch is not fetched | `dm repos` shows the missing line; `git fetch` for a missing branch |

---

## FAQ

**How is this different from other memory tools for coding agents?**
Many use SQLite FTS5's default tokenizer, which does not split Chinese, so Chinese conversations are nearly unsearchable.
Some summarise every step into English with a model, which costs tokens and can lose a decision in the summary.
dev-memory keeps the original text, indexes Chinese properly, costs nothing in the background, and adds a team workflow
where documents are written from the code and go through review and a pull request. If you work only in English and
want fully automatic summaries, another tool may suit you better.

**Why no embeddings (semantic search)?**
Search results are read by the agent, which already rephrases and searches again on its own. Most queries are code
identifiers, which is exactly what keyword ranking (bm25) is good at. Nobody has to run a model service, and when a
search misses, you can see which word failed to match. Hybrid ranking can be added later without collecting anything
again. The full reasoning is in the [illustrated explainer](https://bill-lin.dev/dev-memory/design.html) (Chinese).

**Why SQLite rather than PostgreSQL?**
The data belongs to each person and sharing goes through git. SQLite is a single file with full-text search built in,
and nobody has to run a server.

**Does it send my code or conversations anywhere?**
The plugin does not. Personal mode does not normally touch the network (only `setup` asks gh whether you are logged in);
team mode only uses git and gh against your doc repo. The AI part is the Claude Code or Codex session you already use.

**How many extra tokens does it cost?**
Collecting conversations costs none. Each session carries a little over 300 tokens: a line or two per skill so the
agent knows when to use it, plus a short note at session start. Writing a document costs what any conversation costs,
mostly depending on how much code it reads.

**Can I change how documents are written?**
Yes: edit `schema.md` in the doc repo. No code change and no new release needed.

---

## Status

| | |
|---|---|
| Works | Collecting conversations, Chinese search, cards, personal mode, writing documents from code, the local review page, PRs, lint, staleness checks |
| Used for real | Two real document PRs end to end on Claude Code |
| Not yet verified | Codex hooks in a real session; Windows; Japanese and Korean |
| Not built | Semantic search; the evaluation set has only 5 example cases |

---

## Development

```bash
git clone https://github.com/xinqilin/dev-memory.git
cd dev-memory/plugins/dev-memory
bun install
bun test            # 191 tests
bun run build       # rebuild dist/ after changing src/
```

To try a local copy: `claude --plugin-dir ./plugins/dev-memory`, or `claude plugin marketplace add <path to the clone>`.

```
.claude-plugin/marketplace.json     # Claude Code's marketplace
.agents/plugins/marketplace.json    # Codex's marketplace
plugins/dev-memory/
├── .claude-plugin/plugin.json      # read by Claude Code
├── plugin.json                     # read by Codex
├── .mcp.json / mcp.json            # Claude Code reads only the first, Codex only the second; keep both
├── hooks/hooks.json                # shared: SessionStart catches up, Stop saves each turn incrementally
├── skills/                         # mem-search, mem-save, mem-setup, wiki-ingest, wiki-lint
├── src/
│   ├── cli.ts                      # entry point for everything
│   ├── mcp-server.ts               # memory_search / memory_get
│   ├── hooks/                      # session-start, stop
│   ├── adapters/                   # both tools' transcripts → one format
│   ├── review/                     # the local review page
│   └── core/                       # database, tokenizer, search, sync, worktrees, lint…
├── dist/                           # bundled MCP server and review page; committed
└── test/
templates/memory-repo/              # the skeleton init-repo copies into a doc repo
```

**Releasing**: bump the version in `plugin.json`, `.claude-plugin/plugin.json` and `package.json` together → `bun run build`
(the MCP server embeds the version, so build after bumping) → `bun test` → commit. Without a new version number, users'
`plugin update` will not pick up the change.

CI (`.github/workflows/test.yml`) runs the full suite on every push and fails if `dist/` does not match the source.

**Rules**:

- Skills must not name a tool that only one of the two agents has; both have to work
- User data always lives in `~/.dev-memory/`
- Memories, conversations and real data **never go into this repository**: the plugin is copied to every machine that installs it
- `dist/` is committed: installing from git gives no `node_modules`
- The plugin never installs software on its own

---

## License

[Apache-2.0](LICENSE)
