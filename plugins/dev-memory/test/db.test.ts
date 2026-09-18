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
    tokenizeForIndex("sapStatus 維持 WAIT_FOR_INSERT_MIDDLE_DB，例外處理要彙總"),
    "turn",
    "claude-code:s1:1",
  ]);

  const hit = db.query("select ref from fts where fts match ?").get(buildMatchQuery("例外處理")!) as { ref: string };
  expect(hit.ref).toBe("claude-code:s1:1");
  expect(db.query("select ref from fts where fts match ?").get(buildMatchQuery("排程")!)).toBeNull();
  db.close();
});
