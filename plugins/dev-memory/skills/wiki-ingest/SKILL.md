---
name: wiki-ingest
description: Turn recent development memory into wiki pages in the team memory repo. Use when the user wants to write up what was decided, update the wiki, or prepare a memory PR. Never pushes.
---

# Wiki ingest

Records are raw material; the wiki is what people read. This skill turns one into the other.

**You never push and you never open a PR.** Publishing is a button the author presses on the review page. Do not call `/api/publish`, do not run `dev-memory publish`, do not run `git push`.

Let `CLI` mean `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts"`.

## 0. Decide the scope

Ask what this ingest covers if it is not obvious: a feature, a branch, a date range. Then find the material:

```bash
CLI search <words about the topic> --limit 20
CLI search <words> --kind record --json
```

## 1. Candidate records — **confirmation point ①**

List what you found as cards, each with: 原因 / 決定 / 放棄, and the record id or turn id it came from.

Show the list and ask the author to delete, merge or correct. Nothing proceeds until they answer.

If a decision from this conversation is not in the memory yet, save it first with the mem-save skill.

## 2. The plan — **confirmation point ②**

Open the worktree (this never touches the author's own clone):

```bash
CLI ingest-start <slug>     # prints the branch and the worktree path
```

Read `schema.md` and `wiki/index.md` in that worktree first — the rules live there, not here.

Then propose a plan, picking only from these actions:

| action | when |
|---|---|
| 新增頁面 | nothing covers this yet |
| 更新頁面 | a page exists and the new material extends it |
| 取代決策 | a new decision overrides an old one: old page gets `status: superseded` + `superseded_by`, new page links back with `related` |
| 不動 | already covered; say so rather than writing a duplicate |

Show the plan as a list of `action · path · one line why`. Wait for the author to agree.

## 3. Write the pages

Write in the worktree, following `schema.md`:

- frontmatter: `type`, `title`, `product`, `status`, `sources` (the record ids from step 1), `code_refs`, `related`, `updated`
- body: 原因 / 決定 / 放棄, in the language the discussion used
- every claim traces back to a record in `sources`; if you cannot trace it, leave it out
- update `wiki/index.md` so the new pages are reachable, and append one block to `wiki/log.md`

Never write secrets, credentials or personal data.

Then write the records themselves into the repo:

```bash
CLI export --branch <branch>
```

That appends the local records to `records/<product>/<yyyy-mm>/<author>.jsonl` and marks them
submitted. One file per author per month, append-only, so two people submitting in the same month
never touch the same file.

If the repo is an existing documentation repo and its own docs are not listed yet:

```bash
CLI index-docs
```

## 4. Review page — **confirmation point ③**

```bash
CLI review --branch <branch>
```

This prints a URL and opens the browser. Tell the author it is now theirs: edit on the left, preview on the right, compare with main, check the source records, then **核准並 commit**, and **送出 PR** when they are ready.

While they review you may still edit the files if they ask — the page reloads by itself. If they have unsaved edits it will ask them which version to keep.

## 5. After the PR is merged

```bash
CLI sync
```

That imports the merged records and pages into the local index, so search finds them.

## If something goes wrong

- **The worktree already exists**: `ingest-start` resumes it, which is what you want after an interruption.
- **Checks fail on the review page**: fix the page and save; 核准 stays disabled until every error is gone.
- **The author wants to abandon the ingest**: they can discard each page in the review page. Removing the worktree entirely is a git command they run themselves.
