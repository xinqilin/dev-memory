import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publish } from "../src/core/publish";
import { ensureWorktree } from "../src/core/worktree";

const dirs: string[] = [];
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

async function ingest(branch = "mem/t/20260918-publish") {
  const root = mkdtempSync(join(tmpdir(), "dev-memory-publish-"));
  dirs.push(root);

  const remote = join(root, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", remote], { encoding: "utf8" });

  const seed = join(root, "seed");
  mkdirSync(seed, { recursive: true });
  git(seed, "init", "-q", "-b", "main");
  await Bun.write(join(seed, "wiki", "index.md"), "# 目錄\n");
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "-u", "origin", "main");

  const clone = join(root, "clone");
  spawnSync("git", ["clone", "-q", remote, clone], { encoding: "utf8" });
  const worktree = ensureWorktree(clone, branch, { fetch: false });
  return { root, remote, clone, branch, worktree: worktree.path };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("pushes the branch once the work is committed", async () => {
  const { remote, worktree, branch } = await ingest();
  await Bun.write(join(worktree, "wiki", "new.md"), "# 新頁\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-q", "-m", "memory");

  const result = publish(worktree, branch, { openPr: false });
  expect(result.message).toContain(`已 push ${branch}`);
  expect(spawnSync("git", ["-C", remote, "branch", "--list", branch], { encoding: "utf8" }).stdout).toContain(branch);
});

test("refuses while there are uncommitted changes", async () => {
  const { worktree, branch } = await ingest("mem/t/20260918-dirty");
  await Bun.write(join(worktree, "wiki", "draft.md"), "還在寫\n");

  expect(() => publish(worktree, branch, { openPr: false })).toThrow("還有沒 commit 的修改");
});

test("refuses when the branch has nothing new", async () => {
  const { worktree, branch } = await ingest("mem/t/20260918-empty");
  expect(() => publish(worktree, branch, { openPr: false })).toThrow("沒有東西可以送出");
});

test("a failed gh still reports the push and how to finish by hand", async () => {
  const { worktree, branch } = await ingest("mem/t/20260918-nogh");
  await Bun.write(join(worktree, "wiki", "new.md"), "# 新頁\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-q", "-m", "memory");

  // gh cannot open a PR against a bare local remote, which is exactly the "gh is unusable" path.
  const result = publish(worktree, branch, {});
  expect(result.url).toBeUndefined();
  expect(result.message).toContain(`已 push ${branch}`);
  expect(result.message).toContain("gh pr create");
});
