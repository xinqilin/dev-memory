import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db";
import { exportRecords } from "../src/core/export";

const dirs: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-export-"));
  dirs.push(dir);
  const worktree = join(dir, "worktree");
  mkdirSync(worktree, { recursive: true });
  return { dir, worktree, db: openDb(join(dir, "memory.db")) };
}

function insert(db: ReturnType<typeof openDb>, overrides: Record<string, unknown> = {}) {
  const row = {
    id: `01JBEXPORT${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(16, "0")}`,
    author: "bill.lin",
    host: "claude-code",
    product: "billing",
    repos: JSON.stringify(["example-org/example-repo"]),
    branch: "feature/x",
    type: "decision",
    title: "匯出報表改成單筆失敗不中斷",
    body: "原因：…\n決定：…\n放棄：…",
    entities: "[]",
    files: "[]",
    commits: "[]",
    supersedes: null,
    content_hash: "sha256:abc",
    created_at: "2026-09-18T01:00:00.000Z",
    ...overrides,
  };
  db.run(
    `insert into record (id, author, host, product, repos, branch, type, title, body, entities, files, commits, supersedes, content_hash, status, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?)`,
    [row.id, row.author, row.host, row.product, row.repos, row.branch, row.type, row.title, row.body, row.entities, row.files, row.commits, row.supersedes, row.content_hash, row.created_at],
  );
  return row;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("writes one file per author, month and product, and marks the records submitted", async () => {
  const { worktree, db } = workspace();
  const mine = insert(db);
  insert(db, { product: "crm", created_at: "2026-10-02T00:00:00.000Z" });

  const result = await exportRecords(db, worktree);
  expect(result.written).toBe(2);
  expect(result.files.sort()).toEqual(["records/billing/2026-09/bill.lin.jsonl", "records/crm/2026-10/bill.lin.jsonl"]);

  const line = JSON.parse((await Bun.file(join(worktree, "records/billing/2026-09/bill.lin.jsonl")).text()).trim());
  expect(line).toMatchObject({ id: mine.id, author: "bill.lin", product: "billing", repos: ["example-org/example-repo"] });
  expect((db.query("select status from record where id = ?").get(mine.id) as { status: string }).status).toBe("submitted");
  db.close();
});

test("exporting twice appends nothing new", async () => {
  const { worktree, db } = workspace();
  insert(db);

  await exportRecords(db, worktree);
  db.run("update record set status = 'local'"); // pretend it was never marked, to force a re-run
  const second = await exportRecords(db, worktree);

  expect(second).toMatchObject({ written: 0, alreadyThere: 1 });
  expect((await Bun.file(join(worktree, "records/billing/2026-09/bill.lin.jsonl")).text()).trim().split("\n")).toHaveLength(1);
  db.close();
});

test("a record with no product lands under unsorted", async () => {
  const { worktree, db } = workspace();
  insert(db, { product: null });

  const result = await exportRecords(db, worktree);
  expect(result.files).toEqual(["records/unsorted/2026-09/bill.lin.jsonl"]);
  db.close();
});

test("two authors in the same month never touch the same file, so their branches merge cleanly", async () => {
  const { dir, db } = workspace();
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };

  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  await Bun.write(join(repo, "README.md"), "# memory\n");
  git(repo, "add", "."), git(repo, "commit", "-q", "-m", "init");

  // Each author exports on their own branch, from the same month.
  for (const author of ["bill.lin", "teammate"]) {
    git(repo, "checkout", "-q", "-b", `mem/${author}`, "main");
    db.run("delete from record");
    insert(db, { author });
    await exportRecords(db, repo);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", `records from ${author}`);
  }

  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--no-edit", "mem/bill.lin");
  git(repo, "merge", "-q", "--no-edit", "mem/teammate"); // throws if git reports a conflict

  const files = git(repo, "ls-tree", "-r", "--name-only", "HEAD").split("\n").filter((f) => f.startsWith("records/"));
  expect(files.sort()).toEqual(["records/billing/2026-09/bill.lin.jsonl", "records/billing/2026-09/teammate.jsonl"]);
  db.close();
});
