import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveFile, sweep, totals } from "../src/core/archive";
import { openDb } from "../src/core/db";
import { search } from "../src/core/search";

const FIXTURES = join(import.meta.dir, "fixtures");
const dirs: string[] = [];

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-archive-"));
  dirs.push(dir);
  return { dir, db: openDb(join(dir, "memory.db")) };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("archives a transcript once and skips it on a second run", async () => {
  const { db } = workspace();
  const path = join(FIXTURES, "claude-code", "session.jsonl");

  const first = await archiveFile(db, path, "claude-code");
  expect(first.inserted).toBe(3);
  expect((db.query("select count(*) as n from turn").get() as { n: number }).n).toBe(3);
  expect((db.query("select count(*) as n from fts where kind = 'turn'").get() as { n: number }).n).toBe(3);

  const second = await archiveFile(db, path, "claude-code");
  expect(second).toMatchObject({ inserted: 0, duplicates: 0, bytes: 0 }); // nothing new to read
  db.close();
});

test("appended lines are picked up and line numbers keep counting", async () => {
  const { dir, db } = workspace();
  const path = join(dir, "session.jsonl");
  const line = (uuid: string, text: string) =>
    JSON.stringify({
      type: "user",
      uuid,
      sessionId: "s1",
      timestamp: "2026-09-18T02:00:00.000Z",
      cwd: null,
      message: { role: "user", content: text },
    });

  await Bun.write(path, line("u1", "第一句") + "\n");
  expect((await archiveFile(db, path, "claude-code")).inserted).toBe(1);

  await Bun.write(path, line("u1", "第一句") + "\n" + line("u2", "第二句，加在後面") + "\n");
  const second = await archiveFile(db, path, "claude-code");
  expect(second.inserted).toBe(1);

  const ids = (db.query("select id from turn order by line_no").all() as { id: string }[]).map((r) => r.id);
  expect(ids).toEqual(["claude-code:s1:1", "claude-code:s1:2"]);
  db.close();
});

test("a half-written last line is left for the next run", async () => {
  const { dir, db } = workspace();
  const path = join(dir, "partial.jsonl");
  const complete = JSON.stringify({ type: "user", sessionId: "s2", cwd: null, message: { role: "user", content: "寫完的一行" } });

  await Bun.write(path, complete + "\n" + '{"type":"user","sessionId":"s2"');
  expect((await archiveFile(db, path, "claude-code")).inserted).toBe(1);

  const partialCursor = db.query("select byte_offset, line_no from archive_cursor where path = ?").get(path) as {
    byte_offset: number;
    line_no: number;
  };
  expect(partialCursor.line_no).toBe(1);
  expect(partialCursor.byte_offset).toBe(Buffer.byteLength(complete + "\n", "utf8"));

  // the writer finishes the line
  await Bun.write(
    path,
    complete + "\n" + JSON.stringify({ type: "user", sessionId: "s2", cwd: null, message: { role: "user", content: "補完的一行" } }) + "\n",
  );
  expect((await archiveFile(db, path, "claude-code")).inserted).toBe(1);
  expect((db.query("select count(*) as n from turn").get() as { n: number }).n).toBe(2);
  db.close();
});

test("a truncated file restarts from the beginning instead of skipping content", async () => {
  const { dir, db } = workspace();
  const path = join(dir, "rotated.jsonl");
  const mk = (id: string, text: string) =>
    JSON.stringify({ type: "user", sessionId: id, cwd: null, message: { role: "user", content: text } }) + "\n";

  await Bun.write(path, mk("s1", "舊的第一句") + mk("s1", "舊的第二句"));
  expect((await archiveFile(db, path, "claude-code")).inserted).toBe(2);

  await Bun.write(path, mk("s2", "重來的一句"));
  expect((await archiveFile(db, path, "claude-code")).inserted).toBe(1);
  expect((db.query("select count(*) as n from turn").get() as { n: number }).n).toBe(3);
  db.close();
});

test("codex chunks resume with the session context from the first line", async () => {
  const { dir, db } = workspace();
  const path = join(dir, "rollout-resume.jsonl");
  const meta = JSON.stringify({
    type: "session_meta",
    timestamp: "t0",
    payload: { session_id: "sx", cwd: "/repo", git: { branch: "main", repository_url: "https://github.com/example-org/example-repo" } },
  });
  const user = JSON.stringify({ type: "event_msg", timestamp: "t1", payload: { type: "user_message", message: "第一個問題" } });
  const agent = JSON.stringify({ type: "event_msg", timestamp: "t2", payload: { type: "agent_message", message: "第一個回答" } });

  await Bun.write(path, meta + "\n" + user + "\n");
  expect((await archiveFile(db, path, "codex")).inserted).toBe(1);

  await Bun.write(path, meta + "\n" + user + "\n" + agent + "\n");
  expect((await archiveFile(db, path, "codex")).inserted).toBe(1);

  const rows = db.query("select id, repo_id, branch from turn order by line_no").all() as {
    id: string;
    repo_id: string;
    branch: string;
  }[];
  expect(rows.map((r) => r.id)).toEqual(["codex:sx:2", "codex:sx:3"]);
  expect(rows.every((r) => r.repo_id === "example-org/example-repo" && r.branch === "main")).toBe(true);
  db.close();
});

test("sweep walks both tools' directories", async () => {
  const { dir, db } = workspace();
  const claudeRoot = join(dir, "claude", "projects", "slug");
  const codexRoot = join(dir, "codex", "sessions", "2026", "09", "18");
  mkdirSync(claudeRoot, { recursive: true });
  mkdirSync(codexRoot, { recursive: true });
  await Bun.write(join(claudeRoot, "a.jsonl"), await Bun.file(join(FIXTURES, "claude-code", "session.jsonl")).text());
  await Bun.write(join(codexRoot, "rollout-x.jsonl"), await Bun.file(join(FIXTURES, "codex", "rollout.jsonl")).text());

  const results = await sweep(db, { claudeRoot: join(dir, "claude", "projects"), codexRoot: join(dir, "codex", "sessions") });
  expect(totals(results)).toEqual({ files: 2, inserted: 5, duplicates: 0 });

  const hosts = (db.query("select distinct host from turn order by host").all() as { host: string }[]).map((r) => r.host);
  expect(hosts).toEqual(["claude-code", "codex"]);
  db.close();
});

const userLine = (uuid: string, cwd: string | null, text: string) =>
  JSON.stringify({ type: "user", uuid, sessionId: "s1", timestamp: "2026-09-26T01:00:00.000Z", cwd, message: { role: "user", content: text } });

test("a session under an excluded directory is skipped for good", async () => {
  const { dir, db } = workspace();
  const path = join(dir, "session.jsonl");
  await Bun.write(
    path,
    [
      userLine("a", "/work/customer-x/api", "客戶的程式，不該被收"),
      userLine("b", "/work/customer-x-2", "名字相近但不在排除的目錄底下"),
      userLine("c", "/work/other", "一般的專案"),
    ].join("\n") + "\n",
  );

  expect((await archiveFile(db, path, "claude-code", ["/work/customer-x/"])).inserted).toBe(2);
  const texts = (db.query("select text from turn order by line_no").all() as { text: string }[]).map((row) => row.text);
  expect(texts).toEqual(["名字相近但不在排除的目錄底下", "一般的專案"]);

  // Dropping the exclusion later does not bring the skipped line back: it was consumed, not deferred.
  expect((await archiveFile(db, path, "claude-code")).inserted).toBe(0);
  db.close();
});

test("a token in a turn is masked before it is stored and indexed", async () => {
  const { dir, db } = workspace();
  const path = join(dir, "session.jsonl");
  await Bun.write(path, userLine("a", null, "用這個 token：ghp_abcdefghijklmnopqrstuvwxyz123456 重跑一次") + "\n");

  await archiveFile(db, path, "claude-code");

  expect((db.query("select text from turn").get() as { text: string }).text).toBe("用這個 token：[REDACTED:GitHub token] 重跑一次");
  expect(search(db, "ghp_abcdefghijklmnopqrstuvwxyz123456")).toEqual([]);
  expect(search(db, "重跑")).toHaveLength(1);
  db.close();
});
