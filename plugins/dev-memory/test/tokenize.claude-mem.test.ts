// Integration spike against the local claude-mem database (read-only, never copied into the repo).
// Skipped automatically on machines without ~/.claude-mem/claude-mem.db.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildMatchQuery, tokenizeForIndex } from "../src/core/tokenize";

const SOURCE = process.env.CLAUDE_MEM_DB ?? join(homedir(), ".claude-mem", "claude-mem.db");
const FIELDS = ["title", "subtitle", "narrative", "text", "facts", "concepts"] as const;

test.skipIf(!existsSync(SOURCE))("bigram FTS5 matches LIKE on claude-mem observations", () => {
  // immutable: the file is in WAL mode, and a plain read-only open fails once claude-mem has stopped
  // and taken its -shm file with it. The test compares two counts over one snapshot, so skipping
  // whatever is still in the WAL changes nothing.
  const src = new Database(`file:${SOURCE}?immutable=1`, { readonly: true });
  const rows = src.query(`select id, ${FIELDS.join(", ")} from observations`).all() as Record<string, any>[];

  const likeCount = (needle: string) => {
    const where = FIELDS.map((f) => `${f} like ? escape '\\'`).join(" or ");
    const pattern = `%${needle.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    return (src.query(`select count(*) as n from observations where ${where}`).get(...FIELDS.map(() => pattern)) as { n: number }).n;
  };

  const idx = new Database(":memory:");
  idx.run(`create virtual table bigram using fts5(body, tokenize = "unicode61 tokenchars '_'")`);
  idx.run(`create virtual table plain using fts5(body, tokenize = "unicode61")`);

  const started = performance.now();
  const insert = idx.prepare("insert into bigram(rowid, body) values (?, ?)");
  idx.transaction(() => {
    for (const r of rows) insert.run(r.id, tokenizeForIndex(FIELDS.map((f) => r[f] ?? "").join("\n")));
  })();
  const buildMs = performance.now() - started;

  const plainInsert = idx.prepare("insert into plain(rowid, body) values (?, ?)");
  idx.transaction(() => {
    for (const r of rows) plainInsert.run(r.id, FIELDS.map((f) => r[f] ?? "").join("\n"));
  })();

  const matchCount = (q: string) =>
    (idx.query("select count(*) as n from bigram where bigram match ?").get(buildMatchQuery(q)!) as { n: number }).n;
  const plainCount = (q: string) =>
    (idx.query("select count(*) as n from plain where plain match ?").get(`"${q}"`) as { n: number }).n;

  console.log(`rows=${rows.length} build_ms=${buildMs.toFixed(0)}`);
  for (const term of ["例外", "例外處理", "資料", "排程", "決策", "測試"]) {
    const like = likeCount(term);
    const match = matchCount(term);
    console.log(`term=${term} like=${like} bigram_match=${match} plain_unicode61_match=${plainCount(term)}`);
    expect(match).toBe(like);
  }

  // Any long SNAKE_CASE identifier in this person's data will do: it has to match as a whole token.
  const id = rows.map((r) => FIELDS.map((f) => r[f] ?? "").join("\n").match(/\b[A-Z]+(?:_[A-Z]+){2,}\b/)?.[0]).find(Boolean);
  if (id) {
    const idMatch = matchCount(id);
    console.log(`term=${id} like=${likeCount(id)} bigram_match=${idMatch} plain_unicode61_match=${plainCount(id)}`);
    expect(idMatch).toBeGreaterThan(0);
  }
});
