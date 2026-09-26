// Pages are copies of the memory repo and can always be synced again. Nothing else is:
// turns outlive the transcripts they came from (Claude Code deletes its own after 30 days by default), and
// records exist only here until they are submitted, which in personal mode is never.
// Back this file up; deleting it is not a recovery step.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./config";
import { tokenizeForIndex } from "./tokenize";

/** A migration step is either SQL, or code for what SQL cannot do (re-tokenizing, for one). */
type Step = string | ((db: Database) => void);

/**
 * Rebuild the keyword index from the original text, which every table keeps. Needed whenever
 * the tokenizer changes: the index holds pre-tokenized text, so old rows would stay tokenized
 * the old way and never match queries built the new way. Purely local and takes seconds.
 */
function rebuildFts(db: Database): void {
  db.run("delete from fts");
  const insert = db.prepare("insert into fts (body, kind, ref) values (?, ?, ?)");

  for (const row of db.query("select id, text from turn").all() as { id: string; text: string }[]) {
    insert.run(tokenizeForIndex(row.text), "turn", row.id);
  }
  for (const row of db.query("select id, title, body from record").all() as { id: string; title: string; body: string }[]) {
    insert.run(tokenizeForIndex(`${row.title}\n${row.body}`), "record", row.id);
  }
  const pages = db.query("select path, title, body, status from page").all() as {
    path: string;
    title: string | null;
    body: string;
    status: string | null;
  }[];
  for (const row of pages) {
    if (row.status === "superseded") continue; // kept for history, never a search hit
    insert.run(tokenizeForIndex(`${row.title ?? ""}\n${row.body}`), "page", row.path);
  }
}

// One array per schema version; each entry is applied in a transaction.
const MIGRATIONS: Step[][] = [
  [
    // Raw conversation turns. Local only, never committed.
    `create table turn (
      id text primary key,                -- <host>:<session_id>:<line_no>
      host text not null,                 -- claude-code | codex
      session_id text not null,
      line_no integer not null,
      ts text,
      role text not null,                 -- user | agent
      text text not null,
      cwd text,
      repo_id text,                       -- owner/repo, null outside git
      branch text,
      created_at text not null default (datetime('now'))
    )`,
    `create index turn_session on turn(host, session_id, line_no)`,
    `create index turn_repo on turn(repo_id, ts)`,

    // How far each transcript file has been archived, so Stop only reads new bytes.
    `create table archive_cursor (
      path text primary key,
      byte_offset integer not null default 0,
      updated_at text not null default (datetime('now'))
    )`,

    // Memory records. JSON columns mirror the JSONL committed to the memory repo.
    `create table record (
      id text primary key,                -- ULID
      author text not null,
      host text not null,
      product text,
      repos text not null default '[]',
      branch text,
      type text not null,                 -- decision | feature | runbook | ...
      title text not null,
      body text not null,
      entities text not null default '[]',
      files text not null default '[]',
      commits text not null default '[]',
      supersedes text,
      content_hash text not null,
      status text not null default 'local',  -- local | submitted | merged
      created_at text not null
    )`,
    `create index record_status on record(status)`,
    `create index record_product on record(product, created_at)`,

    // Wiki pages, rebuilt from origin/main.
    `create table page (
      path text primary key,
      product text,
      type text,
      title text,
      status text,
      sources text not null default '[]',
      code_refs text not null default '[]',
      updated text,
      body text not null
    )`,

    // Keyword index. Bodies are pre-tokenized by core/tokenize.ts before insert.
    `create virtual table fts using fts5(
      body,
      kind unindexed,
      ref unindexed,
      tokenize = "unicode61 tokenchars '_'"
    )`,

    // Vectors are written only when the embedding provider is not "none".
    `create table vector (
      ref text not null,
      kind text not null,
      model text not null,
      model_digest text,
      dim integer not null,
      content_hash text not null,
      embedding blob not null,
      primary key (ref, kind)
    )`,
    `create table embed_queue (
      ref text not null,
      kind text not null,
      enqueued_at text not null default (datetime('now')),
      primary key (ref, kind)
    )`,
  ],
  [
    // Line numbers must survive a resume, otherwise turn ids shift between chunks.
    `alter table archive_cursor add column line_no integer not null default 0`,
  ],
  [
    // v3: CJK runs now index unigrams as well as bigrams, so a one-character query finds
    // a character at the end of a run. Everything already indexed has to be re-tokenized.
    rebuildFts,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function schemaVersion(db: Database): number {
  return (db.query("pragma user_version").get() as { user_version: number }).user_version;
}

export function migrate(db: Database): number {
  for (let version = schemaVersion(db); version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      for (const step of MIGRATIONS[version]) {
        if (typeof step === "string") db.run(step);
        else step(db);
      }
      db.run(`pragma user_version = ${version + 1}`); // pragmas cannot be parameterized
    })();
  }
  return schemaVersion(db);
}

/** Opens (creating if needed) the database and brings it up to the current schema. */
export function openDb(path: string = dbPath()): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run("pragma journal_mode = wal");
  migrate(db);
  return db;
}

export function sqliteVersion(db: Database): string {
  return (db.query("select sqlite_version() as version").get() as { version: string }).version;
}

/** FTS5 is not optional: without it there is no keyword search at all. */
export function hasFts5(db: Database): boolean {
  return (db.query("pragma compile_options").all() as { compile_options: string }[]).some(
    (row) => row.compile_options === "ENABLE_FTS5",
  );
}
