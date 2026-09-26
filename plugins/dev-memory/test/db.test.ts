import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, hasFts5, openDb, schemaVersion } from "../src/core/db";
import { buildMatchQuery, tokenizeForIndex } from "../src/core/tokenize";

const dirs: string[] = [];
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-db-"));
  dirs.push(dir);
  return join(dir, "nested", "memory.db"); // nested: openDb must create the directory
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("openDb creates the file, the directory and every table", () => {
  const db = openDb(tempDb());
  const tables = (db.query("select name from sqlite_master where type in ('table','view') order by name").all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => !n.startsWith("fts_") && !n.startsWith("sqlite_"));

  expect(tables).toContain("turn");
  expect(tables).toContain("archive_cursor");
  expect(tables).toContain("record");
  expect(tables).toContain("page");
  expect(tables).toContain("fts");
  expect(tables).toContain("vector");
  expect(tables).toContain("embed_queue");
  expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
  expect(hasFts5(db)).toBe(true);
  db.close();
});

test("migrations are idempotent across reopens", () => {
  const path = tempDb();
  openDb(path).close();
  const db = openDb(path);
  expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
  expect((db.query("select count(*) as n from sqlite_master where name = 'turn'").get() as { n: number }).n).toBe(1);
  db.close();
});

test("turn rows survive a reopen and the id is the primary key", () => {
  const path = tempDb();
  const first = openDb(path);
  const insert = "insert into turn (id, host, session_id, line_no, role, text, cwd, repo_id) values (?, ?, ?, ?, ?, ?, ?, ?)";
  first.run(insert, ["claude-code:s1:1", "claude-code", "s1", 1, "user", "決定改用 bigram", "/repo", "example-org/example-repo"]);
  expect(() => first.run(insert, ["claude-code:s1:1", "claude-code", "s1", 1, "user", "dup", "/repo", null])).toThrow();
  first.close();

  const second = openDb(path);
  expect((second.query("select text from turn where id = ?").get("claude-code:s1:1") as { text: string }).text).toBe("決定改用 bigram");
  second.close();
});

test("the fts table indexes pre-tokenized bodies and finds Chinese", () => {
  const db = openDb(tempDb());
  db.run("insert into fts (body, kind, ref) values (?, ?, ?)", [
    tokenizeForIndex("invoiceStatus 維持 WAIT_FOR_INSERT_STAGING_DB，例外處理要彙總"),
    "turn",
    "claude-code:s1:1",
  ]);

  const hit = db.query("select ref from fts where fts match ?").get(buildMatchQuery("例外處理")!) as { ref: string };
  expect(hit.ref).toBe("claude-code:s1:1");
  expect(db.query("select ref from fts where fts match ?").get(buildMatchQuery("排程")!)).toBeNull();
  db.close();
});

// An index built by the old tokenizer (bigrams only) must be re-tokenized on upgrade, or the
// one-character fix would only apply to turns archived after the upgrade.
test("upgrading to v3 re-tokenizes what is already indexed", () => {
  const path = tempDb();
  const db = openDb(path);

  // Simulate a v2 database: rows indexed the old way, bigrams only.
  db.run(
    "insert into turn (id, host, session_id, line_no, role, text) values ('t1', 'claude-code', 's', 1, 'user', '搭公車')",
  );
  db.run("insert into record (id, author, host, type, title, body, content_hash, created_at) values ('r1', 'a', 'claude-code', 'decision', '要繳稅', 'b', 'sha256:x', '2026-09-21')");
  db.run("insert into page (path, title, status, body) values ('spec/old.md', '舊頁', 'superseded', '搭公車')");
  db.run("delete from fts");
  db.run("insert into fts (body, kind, ref) values ('搭公 公車', 'turn', 't1')");
  db.run("insert into fts (body, kind, ref) values ('要繳 繳稅 b', 'record', 'r1')");
  db.run("pragma user_version = 2");
  db.close();

  const upgraded = openDb(path);
  expect(schemaVersion(upgraded)).toBe(SCHEMA_VERSION);

  const hit = (q: string) =>
    (upgraded.query("select ref from fts where fts match ?").all(`"${q}"`) as { ref: string }[]).map((r) => r.ref);
  expect(hit("車")).toEqual(["t1"]); // the character that ends a run is now its own token
  expect(hit("稅")).toEqual(["r1"]);
  // A superseded page stays out of the index after the rebuild, same as after a sync.
  expect((upgraded.query("select count(*) as n from fts where kind = 'page'").get() as { n: number }).n).toBe(0);
  upgraded.close();
});
