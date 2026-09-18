import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFiles, headCommit } from "../src/core/git-files";

const dirs: string[] = [];
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

async function repo() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-git-"));
  dirs.push(dir);
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", "git@github.com:example-org/example-repo.git");
  await Bun.write(join(dir, "kept.txt"), "start\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("collects committed, staged and untracked changes with the repo id", async () => {
  const dir = await repo();
  const start = headCommit(dir)!;
  expect(start).toHaveLength(40);

  await Bun.write(join(dir, "committed.txt"), "done\n");
  git(dir, "add", "committed.txt");
  git(dir, "commit", "-q", "-m", "second");

  await Bun.write(join(dir, "staged.txt"), "staged\n");
  git(dir, "add", "staged.txt");
  await Bun.write(join(dir, "dirty.txt"), "not added\n");

  const files = changedFiles(dir, start);
  expect(files).toEqual([
    { repo: "example-org/example-repo", path: "committed.txt", staged: false, committed: true },
    { repo: "example-org/example-repo", path: "dirty.txt", staged: false, committed: false },
    { repo: "example-org/example-repo", path: "staged.txt", staged: true, committed: false },
  ]);
});

test("without a starting commit only the working tree is reported", async () => {
  const dir = await repo();
  await Bun.write(join(dir, "kept.txt"), "changed\n");

  expect(changedFiles(dir)).toEqual([
    { repo: "example-org/example-repo", path: "kept.txt", staged: false, committed: false },
  ]);
});

test("a clean repo reports nothing, and a non-git directory is empty", async () => {
  const dir = await repo();
  expect(changedFiles(dir, headCommit(dir))).toEqual([]);

  const plain = mkdtempSync(join(tmpdir(), "dev-memory-plain-"));
  dirs.push(plain);
  expect(changedFiles(plain, "deadbeef")).toEqual([]);
  expect(headCommit(plain)).toBeNull();
});

test("a rename is reported under its new path", async () => {
  const dir = await repo();
  const start = headCommit(dir)!;
  git(dir, "mv", "kept.txt", "renamed.txt");

  expect(changedFiles(dir, start).map((f) => f.path)).toEqual(["renamed.txt"]);
});
