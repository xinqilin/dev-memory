// The local database is only an index: the memory repo is the source of truth,
// so deleting memory.db and rebuilding is always a valid recovery.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./config";

// One array per schema version; each entry is applied in a transaction.
const MIGRATIONS: string[][] = [
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
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function schemaVersion(db: Database): number {
  return (db.query("pragma user_version").get() as { user_version: number }).user_version;
}

export function migrate(db: Database): number {
  for (let version = schemaVersion(db); version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      for (const statement of MIGRATIONS[version]) db.run(statement);
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
