#!/usr/bin/env bun
// SessionStart hook: catch up on anything Stop missed (a killed session, a crash),
// then tell the agent what the memory holds and how to search it.
import { sweep, totals } from "../core/archive";
import { loadConfig } from "../core/config";
import { openDb } from "../core/db";
import { repoIdFromDir } from "../core/repo-id";
import { emitContext, readHookPayload } from "./shared";

const payload = await readHookPayload();

try {
  const db = openDb();
  let line: string;
  try {
    const { inserted } = totals(await sweep(db));
    const turns = (db.query("select count(*) as n from turn").get() as { n: number }).n;
    const records = (db.query("select count(*) as n from record").get() as { n: number }).n;
    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    const repo = repoIdFromDir(cwd);
    const { provider } = (await loadConfig()).embedding;

    line = [
      `dev-memory: ${turns} turns, ${records} records indexed${inserted ? ` (+${inserted} just now)` : ""}.`,
      `Repo: ${repo ?? "not a git repo — nothing will be submitted from here"}. Search mode: ${provider === "none" ? "keyword only" : provider}.`,
      "Before answering questions about past decisions in this codebase, search the development memory first (memory_search, or `dev-memory search <words>`).",
      "When a decision is made — the reason, what was decided, what was rejected — offer to save it with the mem-save skill.",
      "If you answered a question by piecing together records or raw conversation, and no document already says it, offer to save the answer as a note with the mem-save skill. Documents are written one per subject, when the subject is finished, with the wiki-ingest skill; never offer a document per answer.",
    ].join("\n");
  } finally {
    db.close();
  }
  emitContext(line);
} catch (error) {
  console.error(`dev-memory session-start hook: ${error}`);
}

process.exit(0);
