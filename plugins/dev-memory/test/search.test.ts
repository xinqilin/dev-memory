import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeTurns } from "../src/core/archive";
import { openDb } from "../src/core/db";
import { get, search } from "../src/core/search";
import { tokenizeForIndex } from "../src/core/tokenize";
import type { Turn } from "../src/adapters/types";

const dirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-search-"));
  dirs.push(dir);
  return openDb(join(dir, "memory.db"));
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function turn(n: number, text: string, repoId: string | null = "example-org/example-repo"): Turn {
  return {
    id: `claude-code:s1:${n}`,
    host: "claude-code",
    sessionId: "s1",
    lineNo: n,
    ts: "2026-09-18T01:00:00.000Z",
    role: n % 2 === 0 ? "agent" : "user",
    text,
    cwd: "/repo",
    repoId,
    branch: "main",
  };
}

test("finds Chinese and identifiers in archived turns", () => {
  const db = freshDb();
  storeTurns(db, [
    turn(1, "匯出報表失敗時不要整批中斷"),
    turn(2, "決定：單筆失敗寫進 failedRows，整批照跑"),
    turn(3, "順便把 retry 次數設成 3"),
  ]);

  expect(search(db, "整批中斷").map((h) => h.ref)).toEqual(["claude-code:s1:1"]);
  expect(search(db, "failedRows").map((h) => h.ref)).toEqual(["claude-code:s1:2"]);
  expect(search(db, "沒有這種東西")).toEqual([]);
  db.close();
});

test("a wiki page outranks a record, which outranks a raw turn", () => {
  const db = freshDb();
  const body = "匯出報表的 retry 策略";
  storeTurns(db, [turn(1, body)]);
  db.run("insert into record (id, author, host, type, title, body, content_hash, created_at) values (?,?,?,?,?,?,?,?)", [
    "rec1",
    "bill.lin",
    "claude-code",
    "decision",
    "匯出報表的 retry 策略",
    body,
    "sha256:x",
    "2026-09-18",
  ]);
  db.run("insert into fts (body, kind, ref) values (?, 'record', 'rec1')", [tokenizeForIndex(body)]);
  db.run("insert into page (path, title, body) values ('wiki/billing/decisions/retry.md', '匯出報表的 retry 策略', ?)", [body]);
  db.run("insert into fts (body, kind, ref) values (?, 'page', 'wiki/billing/decisions/retry.md')", [tokenizeForIndex(body)]);

  expect(search(db, "retry 策略").map((h) => h.kind)).toEqual(["page", "record", "turn"]);
  db.close();
});

test("hits from the current repo come first without hiding the rest", () => {
  const db = freshDb();
  storeTurns(db, [turn(1, "排程失敗要重試", "example-org/other-repo"), turn(2, "排程失敗要重試", "example-org/example-repo")]);

  const hits = search(db, "排程失敗", { repoId: "example-org/example-repo" });
  expect(hits.map((h) => h.repoId)).toEqual(["example-org/example-repo", "example-org/other-repo"]);
  db.close();
});

test("kind filter and limit are honoured, and get returns the full text", () => {
  const db = freshDb();
  storeTurns(db, [turn(1, "第一句 排程"), turn(2, "第二句 排程"), turn(3, "第三句 排程")]);

  expect(search(db, "排程", { limit: 2 })).toHaveLength(2);
  expect(search(db, "排程", { kinds: ["page"] })).toEqual([]);
  expect(get(db, "turn", "claude-code:s1:2")).toBe("第二句 排程");
  expect(get(db, "turn", "missing")).toBeNull();
  db.close();
});

test("the snippet marks the matched part", () => {
  const db = freshDb();
  storeTurns(db, [turn(1, "決定改用 bigram 斷詞，放棄原本的 unicode61")]);
  const [hit] = search(db, "bigram");
  expect(hit.snippet).toContain("[bigram]");
  expect(hit.title).toStartWith("使用者: ");
  db.close();
});

test("the snippet comes from the original text, not the tokenized body", () => {
  const db = freshDb();
  storeTurns(db, [turn(1, "先確認 stack trace：因為佔位符而拋例外，要找出為什麼那個欄位是空的")]);

  const [hit] = search(db, "例外");
  expect(hit.snippet).toContain("拋[例外]，要找出");
  expect(hit.snippet).not.toContain("拋例 例外"); // bigrams must never reach the reader
  db.close();
});

test("a long body is trimmed around the match", () => {
  const db = freshDb();
  storeTurns(db, [turn(1, "前面".repeat(80) + "關鍵字在中間" + "後面".repeat(80))]);

  const [hit] = search(db, "關鍵字");
  expect(hit.snippet).toStartWith("… ");
  expect(hit.snippet).toEndWith(" …");
  expect(hit.snippet).toContain("[關鍵字]");
  expect(hit.snippet.length).toBeLessThan(200);
  db.close();
});
