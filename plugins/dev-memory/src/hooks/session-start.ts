#!/usr/bin/env bun
// SessionStart hook: catch up on anything Stop missed (a killed session, a crash),
// then tell the agent what the memory holds and how to search it.
import { sweep, totals } from "../core/archive";
import { loadConfig } from "../core/config";
import { openDb } from "../core/db";
import { logHookError } from "../core/hook-log";
import { repoIdFromDir } from "../core/repo-id";
import { writeShims } from "../core/shim";
import { emitContext, readHookPayload } from "./shared";

const payload = await readHookPayload();

try {
  // Loaded first on purpose: when the exclusion list cannot be read, nothing is collected until it
  // can be. The cursors do not move, so the next run catches up and nothing is lost.
  const config = await loadConfig();
  try {
    writeShims();
  } catch (error) {
    logHookError("session-start", error); // a convenience; never worth skipping the sweep for
  }
  const db = openDb();
  let line: string;
  try {
    const { inserted } = totals(await sweep(db, { exclude: config.capture.exclude }));
    const turns = (db.query("select count(*) as n from turn").get() as { n: number }).n;
    const records = (db.query("select count(*) as n from record").get() as { n: number }).n;
    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    const repo = repoIdFromDir(cwd);
    const { provider } = config.embedding;

    line = [
      `dev-memory: ${turns} turns, ${records} records indexed${inserted ? ` (+${inserted} just now)` : ""}.`,
      `Repo: ${repo ?? "not a git repo — nothing will be submitted from here"}. Search mode: ${provider === "none" ? "keyword only" : provider}.`,
      "When the user refers to something discussed before (上次、之前、那個…), asks about a past decision, or needs background on this project, search the development memory first (memory_search, or `dev-memory search <words>`); the mem-search skill says how.",
      "When a decision is made — the reason, what was decided, what was rejected — offer to save it with the mem-save skill.",
      config.memory.repo
        ? "If you answered a question by piecing together records or raw conversation, and no document already says it, offer to save the answer as a note with the mem-save skill. Documents are written one per subject, when the subject is finished, with the wiki-ingest skill; never offer a document per answer."
        : "Personal mode: no team repo is configured, so records stay on this machine and there are no documents to write. If you answered a question by piecing together records or raw conversation, offer to save the answer as a note with the mem-save skill.",
    ].join("\n");
  } finally {
    db.close();
  }
  emitContext(line);
} catch (error) {
  logHookError("session-start", error);
}

process.exit(0);
