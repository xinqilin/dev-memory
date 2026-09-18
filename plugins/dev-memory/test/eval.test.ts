import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeTurns } from "../src/core/archive";
import { openDb } from "../src/core/db";
import { formatReport, parseCases, runEval, suggestCases } from "../src/core/eval";
import type { Turn } from "../src/adapters/types";

const dirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-eval-"));
  dirs.push(dir);
  return openDb(join(dir, "memory.db"));
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const turn = (n: number, text: string): Turn => ({
  id: `claude-code:s1:${n}`,
  host: "claude-code",
  sessionId: "s1",
  lineNo: n,
  ts: null,
  role: "agent",
  text,
  cwd: null,
  repoId: null,
  branch: null,
});

test("parseCases rejects a case without an expectation", () => {
  expect(() => parseCases("cases:\n  - id: a\n    query: 中文\n    expect: {}\n")).toThrow("needs expect.all_of or expect.any_of");
  expect(() => parseCases("cases:\n  - query: 中文\n")).toThrow("needs id, query and expect");
  expect(parseCases("cases: []")).toEqual([]);
});

test("scores recall and MRR over the top hits", () => {
  const db = freshDb();
  storeTurns(db, [
    turn(1, "中文斷詞改用 bigram，識別字另外拆 camelCase"),
    turn(2, "排程每天兩點跑，失敗會重試三次"),
    turn(3, "無關的閒聊"),
  ]);

  const cases = parseCases(`
cases:
  - id: tokenizer
    query: 中文怎麼切字
    expect:
      any_of: ["bigram"]
  - id: schedule
    query: 排程幾點跑
    expect:
      all_of: ["兩點", "重試"]
  - id: missing
    query: 完全沒記過的東西
    expect:
      any_of: ["不存在的字串"]
`);

  const report = runEval(db, cases);
  expect(report.cases.map((c) => c.rank)).toEqual([1, 1, null]);
  expect(report.recall).toBeCloseTo(2 / 3, 5);
  expect(report.mrr).toBeCloseTo(2 / 3, 5);
  expect(formatReport(report)).toContain("Recall@5: 66.7%");
  db.close();
});

test("a relevant hit outside the limit counts as a miss", () => {
  const db = freshDb();
  // The decoys repeat the query term and stay short, so bm25 ranks them above the long answer.
  storeTurns(db, [
    ...Array.from({ length: 6 }, (_, i) => turn(i + 1, `排程 排程 排程 排程 ${i}`)),
    turn(7, `真正答案是每天兩點跑 排程 ${"其他無關的內容 ".repeat(40)}`),
  ]);

  const cases = parseCases(`
cases:
  - id: deep
    query: 排程
    expect:
      all_of: ["真正答案"]
`);

  expect(runEval(db, cases, 3).cases[0].rank).toBeNull();
  expect(runEval(db, cases, 10).cases[0].rank).not.toBeNull();
  db.close();
});

test("the shipped example file parses", async () => {
  const cases = parseCases(await Bun.file(join(import.meta.dir, "..", "eval", "queries.example.yaml")).text());
  expect(cases.length).toBeGreaterThanOrEqual(5);
  expect(cases.every((c) => c.id && c.query)).toBe(true);
});

test("suggested cases come from the memory and parse as a case file", () => {
  const db = freshDb();
  db.run(
    `insert into record (id, author, host, type, title, body, content_hash, created_at, status)
     values ('01JBSUGGEST00000000000001', 'bill.lin', 'claude-code', 'decision', '搜尋改成 OR', '用 buildSearchQuery 之後 Recall@5 從 0% 變 40%', 'sha256:x', '2026-09-18', 'local')`,
  );

  const yaml = suggestCases(db, 5);
  expect(yaml).toContain("搜尋改成 OR");
  expect(yaml).toContain("buildSearchQuery"); // an identifier is a better expectation than a common word
  expect(yaml).toContain("← 改成你自己的問法"); // the seeded query is a starting point, not the eval

  const cases = parseCases(yaml);
  expect(cases).toHaveLength(1);
  expect(cases[0].expect.any_of!.length).toBeGreaterThan(0);
  db.close();
});

test("suggesting from an empty memory says so instead of inventing questions", () => {
  const db = freshDb();
  expect(suggestCases(db)).toContain("記憶裡還沒有紀錄或頁面");
  expect(parseCases(suggestCases(db))).toEqual([]);
  db.close();
});
