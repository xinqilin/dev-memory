import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseVersion, branchName, changedPages, ensureWorktree, removeWorktree, slugify } from "../src/core/worktree";

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
