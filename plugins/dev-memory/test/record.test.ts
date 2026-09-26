import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db";
import { addRecord, contentHash, findByContentHash, ulid } from "../src/core/record";
import { search } from "../src/core/search";

const dirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-record-"));
  dirs.push(dir);
  return openDb(join(dir, "memory.db"));
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const INPUT = {
  type: "decision",
  title: "匯出報表改成單筆失敗不中斷",
  body: "原因：整批 rollback 會讓已完成的匯出重跑\n決定：失敗的列寫進 failedRows\n放棄：維持整批 rollback",
  product: "billing",
};

test("ulid is 26 chars and sorts by time", () => {
  const early = ulid(1_700_000_000_000);
  const late = ulid(1_800_000_000_000);
  expect(early).toHaveLength(26);
  expect(early < late).toBe(true);
  expect(ulid()).not.toBe(ulid());
});

test("addRecord stores the row and indexes title and body", () => {
  const db = freshDb();
  const record = addRecord(db, INPUT, { cwd: "/", host: "codex", now: new Date("2026-09-18T03:00:00.000Z") });

  expect(record).toMatchObject({ host: "codex", product: "billing", createdAt: "2026-09-18T03:00:00.000Z" });
  expect(record.contentHash).toStartWith("sha256:");

  const row = db.query("select status, repos, author from record where id = ?").get(record.id) as {
    status: string;
    repos: string;
    author: string;
  };
  expect(row.status).toBe("local");
  expect(JSON.parse(row.repos)).toEqual([]); // "/" is not a git repo
  expect(row.author.length).toBeGreaterThan(0);

  expect(search(db, "failedRows").map((h) => h.ref)).toEqual([record.id]);
  expect(search(db, "整批 rollback")[0].kind).toBe("record");
  db.close();
});

test("the same title and body hashes the same, so saving twice is detectable", () => {
  const db = freshDb();
  const record = addRecord(db, INPUT, { cwd: "/" });

  expect(contentHash(INPUT)).toBe(record.contentHash);
  expect(findByContentHash(db, record.contentHash)).toBe(record.id);
  expect(findByContentHash(db, contentHash({ ...INPUT, title: "別的標題" }))).toBeNull();
  db.close();
});

test("the CLI reads a record from stdin and refuses to save it twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-record-cli-"));
  dirs.push(dir);
  const cli = join(import.meta.dir, "..", "src", "cli.ts");

  const run = async () => {
    const proc = Bun.spawn(["bun", cli, "record"], {
      stdin: new TextEncoder().encode(JSON.stringify(INPUT)),
      stdout: "pipe",
      env: { ...process.env, DEV_MEMORY_HOME: dir },
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { stdout, code };
  };

  const first = await run();
  expect(first.code).toBe(0);
  expect(first.stdout).toContain("saved ");
  expect(first.stdout).toContain("匯出報表改成單筆失敗不中斷");
  expect(first.stdout).toContain(`personal mode: stored only in ${join(dir, "memory.db")}`); // no team repo configured

  const second = await run();
  expect(second.stdout).toStartWith("already saved as ");
});

test("the CLI rejects an incomplete record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-record-bad-"));
  dirs.push(dir);
  const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "cli.ts"), "record"], {
    stdin: new TextEncoder().encode('{"title":"只有標題"}'),
    stderr: "pipe",
    env: { ...process.env, DEV_MEMORY_HOME: dir },
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(2);
  expect(stderr).toContain("record needs at least");
});
