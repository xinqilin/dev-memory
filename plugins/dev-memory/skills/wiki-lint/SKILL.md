---
name: wiki-lint
description: Check the team documentation repo for broken links, pages the index does not reach, duplicate titles, records that cite something that does not exist, and documents the code has moved past. Use when asked to check, audit or tidy the documentation.
---

# Check the documentation

Two halves: what a command can decide, and what only reading can decide. Do both, then ask.

Let `CLI` mean `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts"`.

## 1. The machine half

```bash
CLI lint            # see the exact list below
CLI stale           # asks GitHub whether the code behind each document changed since the document did
CLI entities        # which tables, APIs and queues the records mention, and which have no page yet
```

`CLI lint` checks exactly these, and nothing else:

| | Level |
|---|---|
| A local link that points at no file | error |
| A document `README.md` does not link to | error |
| Documents sharing the same `#` heading | warning |
| A record whose `supersedes` names a record nobody has | error |
| A 26-character record id in the text that is in neither the repo nor the local index | warning |
| Frontmatter left over from the old layout | warning |
| A document with no `#` heading | error |

Report what came back in plain words, grouped by what the author would do about it. Errors block
a clean repo; warnings are judgement calls.

## 2. The judgement half

The command cannot read meaning. You can. Read the documents the topic touches and look for:

- **Contradictions**: two documents that say different things about the same subject. `lint` only
  catches an identical `#` heading; the ones that matter are phrased differently.
- **Claims the code has moved past**: a document describing behaviour that the current code no
  longer has. **Check the code, not the records** — `git show <ref>:<path>` on the repos in
  `repos.yaml`. Records hold the proposal, the code holds what shipped.
- **Documents that answer nothing**: a page that restates what the code says, with no 設計考量
  and no Known Issue, is a worse version of reading the code. Propose merging it into a fuller
  document or dropping it.
- **Missing entity pages**: `CLI entities` lists tables and APIs the records mention. Where several
  repos touch the same one, that entity deserves a page saying who writes it and who reads it.

For each finding, say what is wrong, quote the evidence, and propose one action. Do not rewrite
anything yet.

## 3. Ask before fixing

Show the list and let the author pick what to fix. Then run the ingest flow for those fixes:
they end in the review page, where the author approves and submits — the same path as any other
change.

## Notes

- `stale` needs `gh` logged in with access to the code repos. Without it, it says so and skips
  rather than guessing.
- **Duplicate titles are a warning, not a verdict.** Two documents may legitimately share a
  heading across products. Read both before proposing a merge.
- **Superseding lives on records, not on documents.** A decision that was overturned gets a new
  record whose `supersedes` names the old one; the old record stays. Never rewrite history by
  editing or deleting a record — `records/` is append-only.
- The repo's own `tools/lint.ts` runs in CI and overlaps with `CLI lint` but is not identical:
  it additionally validates the JSONL schema and duplicate record ids, and it cannot see the
  local index. A clean `CLI lint` does not guarantee a green CI.
