#!/usr/bin/env bun
// Stop hook: archive whatever the session has written since the last turn.
// This is the main collection path, because SessionEnd only gets 1-3 seconds.
// It must never fail the session: every error is swallowed after a log line.
import { archiveFile, sweep } from "../core/archive";
import { openDb } from "../core/db";
import { hostFromEnv, readHookPayload } from "./shared";

const payload = await readHookPayload();

try {
  const db = openDb();
  try {
    const path = typeof payload.transcript_path === "string" ? payload.transcript_path : null;
    if (path) {
      await archiveFile(db, path, hostFromEnv());
    } else {
      // Codex may pass null; fall back to scanning both transcript directories.
      await sweep(db);
    }
  } finally {
    db.close();
  }
} catch (error) {
  console.error(`dev-memory stop hook: ${error}`);
}

process.exit(0);
