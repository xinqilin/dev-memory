---
name: mem-search
description: Search the development memory before answering. Use when the user refers to something discussed before (上次、之前、那時候、那個…、我們討論過), asks why something was decided or rejected, asks about the history or background of this project, or when an answer depends on context that is not in the code.
---

# Search the development memory

The memory holds three kinds of entries, best first: `page` (documents), `record` (saved decisions
and notes) and `turn` (raw conversation from both tools, kept after the transcripts are deleted).
Search is keyword search that understands Chinese, so the words you pick decide what comes back.

Let `CLI` mean `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts"`. Use the `memory_search` and `memory_get`
tools when they are available; otherwise `CLI search <words>` and `CLI get <kind> <ref>`.

## 1. Pick the words

- Use the nouns the user would have used at the time: a table, a field, a batch name, a flag, an
  error message. `invoiceStatus`、`中介表`、`重跑` beat a whole question.
- Chinese works best as short terms of two to four characters. Split a long question into its
  key terms instead of searching the sentence.
- Code identifiers can be searched whole or by part: `WAIT_FOR_INSERT_STAGING_DB`, or `staging`.

## 2. Search, then widen

1. Search with the key terms. Hits from the current repo already rank first.
2. Nothing useful: try a second wording — a synonym, the English identifier instead of the Chinese
   description or the other way round, or fewer words.
3. Still nothing after three tries: say so plainly. Do not present a guess as something the memory
   says.

Restrict to `record` when the question is about a decision, and to `turn` when the user is asking
what was said in an earlier conversation.

## 3. Read before answering

A snippet is not enough to answer from. Open the one or two best hits with `memory_get`
(or `CLI get`) and answer from the full text. Cite what you used: the record id, the document
path, or the date of the conversation.

## 4. After answering

If the answer took real digging — pieced together from several hits or from raw conversation —
offer to save it as a note with the mem-save skill.

## Notes

- A newer record can supersede an older one. When two hits disagree, prefer the newer and say
  that the decision changed.
- Raw conversation includes ideas that were later dropped. A `turn` shows what was discussed,
  not what was decided; check for a record before stating a decision as final.
