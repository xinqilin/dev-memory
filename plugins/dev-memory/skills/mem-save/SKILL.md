---
name: mem-save
description: Save a decision from this conversation into the team's development memory. Use when a decision was just made, when the user says to remember something, or when asked to record why an approach was chosen or rejected.
---

# Save a development memory

Records are what the team reads six months from now. A record without the reason is close to useless.

## 1. Draft the record

Write it in the language the conversation used, and keep three things in the body:

- **原因 / Why**: what forced the decision — the constraint, the bug, the number that was too slow.
- **決定 / Decision**: what will happen now, concretely. Name the files, tables, fields or flags.
- **放棄 / Rejected**: the option that was not taken and why. This is the part people forget and the part that saves the most time later.

Keep the title short and searchable: the subject, then what changed.

Pick a `type`:

| type | when |
|---|---|
| `decision` | a choice between options, with a reason |
| `feature` | how something was built across one or more repos |
| `runbook` | steps to operate or recover something |
| `note` | context worth keeping that fits nothing above |

## 2. Show it to the user first

Print the draft and ask for corrections. Never save a record the user has not seen.

## 3. Save it

Pipe the JSON into the CLI from the repository you are working in, so the repo and branch are picked up:

```bash
cat <<'JSON' | bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" record
{
  "type": "decision",
  "title": "匯出報表改成單筆失敗不中斷",
  "body": "原因：整批 rollback 會讓已完成的匯出重跑\n決定：失敗的列寫進 failedRows，整批繼續，最後回報\n放棄：維持整批 rollback",
  "product": "billing",
  "entities": [{"kind": "table", "name": "export_job"}],
  "files": [{"repo": "example-org/example-repo", "path": "src/export/Runner.java"}]
}
JSON
```

`type`, `title` and `body` are required; everything else is optional. `author`, `repos`, `branch` and the timestamp are filled in automatically. Saving the same title and body twice is a no-op, so it is safe to retry.

## 4. Confirm

Show the returned id and tell the user the record is local until it is submitted to the memory repo.

## Notes

- Search before saving (`memory_search`, or `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" search <words>`): if a record already covers this, update the story in a new record and mention which one it supersedes with `"supersedes": "<id>"`.
- Secrets, credentials and personal data never belong in a record.
- Nothing here pushes to git. Submitting records to the team repo is a separate, explicit step the user runs.
