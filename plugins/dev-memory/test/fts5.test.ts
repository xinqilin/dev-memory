import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

test("bun:sqlite supports FTS5 on this platform", () => {
  const db = new Database(":memory:");
  const { version } = db.query("select sqlite_version() as version").get() as { version: string };
  const options = (db.query("pragma compile_options").all() as { compile_options: string }[]).map((r) => r.compile_options);
  console.log(`sqlite_version=${version} platform=${process.platform}/${process.arch} ENABLE_FTS5=${options.includes("ENABLE_FTS5")}`);

  db.run(`create virtual table doc using fts5(body, tokenize = "unicode61 tokenchars '_'")`);
  db.run("insert into doc(body) values (?), (?)", ["invoiceStatus stays WAIT_FOR_INSERT_STAGING_DB", "unrelated row"]);

  const hits = db.query("select rowid from doc where doc match ?").all('"WAIT_FOR_INSERT_STAGING_DB"');
  expect(hits).toEqual([{ rowid: 1 }]);
});
