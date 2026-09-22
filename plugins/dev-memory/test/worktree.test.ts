import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseVersion, branchName, changedPages, discardIngest, ensureWorktree, removeWorktree, slugify, worktreePath } from "../src/core/worktree";
import { openDb } from "../src/core/db";
import { addRecord } from "../src/core/record";

const dirs: string[] = [];
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A remote plus a clone, the shape a memory repo actually has on an author's machine. */
async function repoPair() {
  const root = mkdtempSync(join(tmpdir(), "dev-memory-wt-"));
  dirs.push(root);
  const remote = join(root, "remote");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "-q", "-b", "main");
  await Bun.write(join(remote, "wiki", "index.md"), "# 目錄\n");
  git(remote, "add", ".");
  git(remote, "commit", "-q", "-m", "init");

  const clone = join(root, "clone");
  spawnSync("git", ["clone", "-q", remote, clone], { encoding: "utf8" });
  return { root, remote, clone };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("slug and branch names are readable and safe in a path", () => {
  expect(slugify("Export Report / partial failure")).toBe("export-report-partial-failure");
  expect(slugify("匯出報表")).toBe("匯出報表");
  expect(slugify("!!!")).toBe("memory");
  expect(branchName("bill.lin", "匯出報表", new Date("2026-09-18T00:00:00Z"))).toBe("mem/bill-lin/20260918-匯出報表");
});

test("creates a worktree on a new branch and reuses it on the second call", async () => {
  const { clone } = await repoPair();
  const first = ensureWorktree(clone, "mem/t/20260918-a", { fetch: false });

  expect(first.created).toBe(true);
  expect(existsSync(join(first.path, "wiki", "index.md"))).toBe(true);
  expect(git(first.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("mem/t/20260918-a");

  const second = ensureWorktree(clone, "mem/t/20260918-a", { fetch: false });
  expect(second).toEqual({ ...first, created: false });

  removeWorktree(clone, "mem/t/20260918-a");
  expect(existsSync(first.path)).toBe(false);
});

test("the author's own clone is untouched while the ingest writes", async () => {
  const { clone } = await repoPair();
  const { path } = ensureWorktree(clone, "mem/t/20260918-b", { fetch: false });

  await Bun.write(join(path, "wiki", "new.md"), "草稿\n");
  expect(existsSync(join(clone, "wiki", "new.md"))).toBe(false);
  expect(git(clone, "status", "--porcelain")).toBe("");
});

test("lists what the ingest changed, committed or not", async () => {
  const { clone } = await repoPair();
  const { path } = ensureWorktree(clone, "mem/t/20260918-c", { fetch: false });

  await Bun.write(join(path, "wiki", "added.md"), "新頁\n");
  await Bun.write(join(path, "wiki", "index.md"), "# 目錄\n- 新頁\n");
  git(path, "add", "wiki/index.md");
  git(path, "commit", "-q", "-m", "update index");

  expect(changedPages(path)).toEqual([
    { path: "wiki/added.md", status: "added" },
    { path: "wiki/index.md", status: "modified" },
  ]);
});

test("baseVersion returns the version on main, or null for a new page", async () => {
  const { clone } = await repoPair();
  const { path } = ensureWorktree(clone, "mem/t/20260918-d", { fetch: false });

  expect(baseVersion(path, "wiki/index.md")).toBe("# 目錄\n"); // trailing newline must survive
  expect(baseVersion(path, "wiki/nope.md")).toBeNull();
});

test("a brand-new directory is listed as its files, not as the directory", async () => {
  const { clone } = await repoPair();
  const { path } = ensureWorktree(clone, "mem/t/20260918-e", { fetch: false });

  await Bun.write(join(path, "wiki", "dev-memory", "decisions", "one.md"), "第一頁\n");
  await Bun.write(join(path, "wiki", "dev-memory", "decisions", "two.md"), "第二頁\n");

  expect(changedPages(path).map((f) => f.path)).toEqual([
    "wiki/dev-memory/decisions/one.md",
    "wiki/dev-memory/decisions/two.md",
  ]);
});

// ---------- discarding a whole ingest ----------

const FILE = "records/billing/2026-09/t.jsonl";

/** A memory repo whose main already holds one merged card, and a local index that knows about it. */
async function withCards() {
  const pair = await repoPair();
  const db = openDb(join(pair.root, "memory.db"));
  const card = (title: string, status: string) => {
    const { id } = addRecord(db, { type: "decision", title, body: "原因：…", product: "billing" }, { cwd: pair.root });
    db.run("update record set status = ? where id = ?", [status, id]);
    return id;
  };
  const merged = card("已經在 main 上", "merged");
  await Bun.write(join(pair.remote, FILE), `{"id":"${merged}"}\n`);
  git(pair.remote, "add", ".");
  git(pair.remote, "commit", "-q", "-m", "records");
  git(pair.clone, "fetch", "-q", "origin");
  const status = (id: string) => (db.query("select status from record where id = ?").get(id) as { status: string }).status;
  return { ...pair, db, card, merged, status };
}

const branchExists = (repo: string, branch: string) =>
  spawnSync("git", ["-C", repo, "rev-parse", "--verify", `refs/heads/${branch}`]).status === 0;

test("discarding an ingest hands its cards back, and removes the worktree and the branch", async () => {
  const { clone, db, card, merged, status } = await withCards();
  const branch = "mem/t/20260922-drop";
  const { path } = ensureWorktree(clone, branch, { fetch: false });

  const committed = card("匯出後已 commit", "submitted");
  await Bun.write(join(path, FILE), `{"id":"${merged}"}\n{"id":"${committed}"}\n`);
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "approve");
  const uncommitted = card("匯出後還沒 commit", "submitted");
  await Bun.write(join(path, FILE), `{"id":"${merged}"}\n{"id":"${committed}"}\n{"id":"${uncommitted}"}\n`);

  expect(discardIngest(clone, branch, db)).toEqual({ status: "discarded", returned: 2 });
  expect(status(committed)).toBe("local");
  expect(status(uncommitted)).toBe("local");
  expect(status(merged)).toBe("merged");
  expect(existsSync(path)).toBe(false);
  expect(branchExists(clone, branch)).toBe(false);
});

test("a pushed ingest is left alone: its cards are in a PR", async () => {
  const { clone, db, card, merged, status } = await withCards();
  const branch = "mem/t/20260922-sent";
  const { path } = ensureWorktree(clone, branch, { fetch: false });
  const sent = card("已經送出 PR", "submitted");
  await Bun.write(join(path, FILE), `{"id":"${merged}"}\n{"id":"${sent}"}\n`);
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "approve");
  git(path, "push", "-q", "-u", "origin", branch);

  expect(discardIngest(clone, branch, db)).toEqual({ status: "pushed", returned: 0 });
  expect(status(sent)).toBe("submitted");
  expect(existsSync(path)).toBe(true);
  expect(branchExists(clone, branch)).toBe(true);
});

test("a worktree removed by hand still gives its cards back from the branch", async () => {
  const { clone, db, card, merged, status } = await withCards();
  const branch = "mem/t/20260922-gone";
  const { path } = ensureWorktree(clone, branch, { fetch: false });
  const orphan = card("工作區被手動刪掉", "submitted");
  await Bun.write(join(path, FILE), `{"id":"${merged}"}\n{"id":"${orphan}"}\n`);
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "approve");
  removeWorktree(clone, branch);

  expect(discardIngest(clone, branch, db)).toEqual({ status: "discarded", returned: 1 });
  expect(status(orphan)).toBe("local");
  expect(existsSync(worktreePath(clone, branch))).toBe(false);
  expect(branchExists(clone, branch)).toBe(false);
});

test("discarding an ingest that does not exist changes nothing", async () => {
  const { clone, db } = await withCards();
  expect(discardIngest(clone, "mem/t/20260922-never", db)).toEqual({ status: "missing", returned: 0 });
  expect(branchExists(clone, "mem/t/20260922-never")).toBe(false);
});
