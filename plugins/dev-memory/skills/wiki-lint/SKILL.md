---
name: wiki-lint
description: Check the team memory repo for broken links, orphan pages, pages whose sources do not back them, contradicting decisions, and documentation the code has moved past. Use when asked to check, audit or tidy the wiki.
---

# Wiki lint

Two halves. The machine half is deterministic and runs as a command. The judgement half is yours,
and it is the reason this is a skill and not just a script.

Let `CLI` mean `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts"`.

**You never push.** Fixes go through the normal ingest flow, which ends at the author's review page.

## 1. The machine half

```bash
CLI lint            # links, orphans, superseding, sources[], duplicate titles
CLI stale           # asks GitHub whether the code behind each page changed since the page did
CLI entities        # which tables, APIs and queues the records mention, and which have no page yet
```

Report what came back in plain words, grouped by what the author would do about it. Errors block
a clean repo; warnings are judgement calls.

## 2. The judgement half

The command cannot read meaning. You can. Read the pages that the topic touches and look for:

- **Contradictions**: two active pages that say different things about the same subject. The
  command only catches identical titles; the real cases are phrased differently.
- **Stale claims**: a page that describes behaviour the newer records say was changed. Check the
  records the pages cite — `CLI get record <id>` — before claiming anything.
- **Pages that answer nothing**: a page with no 原因 and no 放棄的方案 is a summary of code, and
  code says it better. Propose merging it into a fuller page or dropping it.
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
- A warning that a page's sources share no wording with it is a hint, not a verdict: read the
  records before acting on it.
- Never delete a superseded page. Mark it, link the replacement, and leave the history intact.
