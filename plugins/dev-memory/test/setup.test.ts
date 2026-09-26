import { afterEach, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureConfig, configPath, loadConfig } from "../src/core/config";
import { hookLogPath, logHookError } from "../src/core/hook-log";
import { formatSetup, runSetup, setMemoryRepo } from "../src/core/setup";

const dirs: string[] = [];
const originalHome = process.env.DEV_MEMORY_HOME;

function home() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-setup-"));
  dirs.push(dir);
  process.env.DEV_MEMORY_HOME = dir;
  return dir;
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

/** A clone of a memory repo, which is what a teammate is asked to point setup at. */
async function memoryRepo(scaffolded = true) {
  const root = mkdtempSync(join(tmpdir(), "dev-memory-setup-repo-"));
  dirs.push(root);
  const remote = join(root, "remote");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "-q", "-b", "main");
  await Bun.write(join(remote, "README.md"), "# memory\n");
  if (scaffolded) {
    // The template's layout: README.md is the index and there is no wiki/ any more.
    await Bun.write(join(remote, "schema.md"), "# 規則\n");
    await Bun.write(join(remote, "records", "README.md"), "# 紀錄\n");
  }
  git(remote, "add", ".");
  git(remote, "commit", "-q", "-m", "init");

  const clone = join(root, "clone");
  spawnSync("git", ["clone", "-q", remote, clone], { encoding: "utf8" });
  return clone;
}

afterEach(() => {
  process.env.DEV_MEMORY_HOME = originalHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("setMemoryRepo edits the config in place and keeps the comments", async () => {
  home();
  await ensureConfig();
  await setMemoryRepo("/somewhere/memory", "main");

  const text = await Bun.file(configPath()).text();
  expect(text).toContain('repo = "/somewhere/memory"');
  expect(text).toContain("# path to your clone of the memory repo"); // the comment survives
  expect(text).toContain('provider = "none"'); // the rest of the file is untouched
  expect((await loadConfig()).memory).toEqual({ repo: "/somewhere/memory", branch: "main" });

  await setMemoryRepo("/elsewhere/memory");
  expect((await loadConfig()).memory.repo).toBe("/elsewhere/memory");
  expect((await Bun.file(configPath()).text()).match(/repo = /g)).toHaveLength(1); // replaced, not appended
});

test("setMemoryRepo adds the section when the config has none", async () => {
  const dir = home();
  await Bun.write(join(dir, "config.toml"), '[embedding]\nprovider = "none"\n');
  await setMemoryRepo("/somewhere/memory");

  expect((await loadConfig()).memory).toEqual({ repo: "/somewhere/memory", branch: "main" });
});

test("a fresh machine without a team repo is set up in personal mode", async () => {
  home();
  const result = await runSetup({ sweep: false, sync: false });

  const repoCheck = result.checks.find((check) => check.name === "memory repo")!;
  expect(repoCheck.ok).toBe(true);
  expect(repoCheck.detail).toContain("個人模式");
  expect(repoCheck.detail).toContain("--repo"); // how to join a team later
  expect(result.checks.find((check) => check.name === "gh")!.ok).toBe(true); // personal mode never opens a PR

  const output = formatSetup(result);
  expect(output).toContain("✓ memory repo");
  expect(output).toContain("都好了（個人模式）");
  expect(result.checks.find((check) => check.name === "本機索引")!.ok).toBe(true); // the index is created regardless
});

test("pointing it at a clone configures it and reports a clean setup", async () => {
  home();
  const repo = await memoryRepo();
  const result = await runSetup({ repo, sweep: false, sync: false });

  expect(result.repo).toBe(repo);
  // gh is this machine's login, not something setup configures; team mode reports it on its own.
  expect(result.checks.filter((check) => check.name !== "gh").every((check) => check.ok)).toBe(true);
  expect((await loadConfig()).memory.repo).toBe(repo);
});

test("a repo without the scaffolding is told to run init-repo", async () => {
  home();
  const repo = await memoryRepo(false);
  const result = await runSetup({ repo, sweep: false, sync: false });

  const structure = result.checks.find((check) => check.name === "repo 結構")!;
  expect(structure.ok).toBe(false);
  expect(structure.fix).toContain("init-repo");
});

test("a path that is not a git repo is caught before anything else runs", async () => {
  home();
  const notARepo = mkdtempSync(join(tmpdir(), "dev-memory-plain-"));
  dirs.push(notARepo);

  const result = await runSetup({ repo: notARepo, sweep: false, sync: false });
  const check = result.checks.find((c) => c.name === "memory repo")!;
  expect(check.ok).toBe(false);
  expect(check.detail).toContain("不是 git repo");
});

test("a hook that failed this week is reported, with where to read the rest", async () => {
  home();
  const silence = spyOn(console, "error").mockImplementation(() => {});
  logHookError("stop", "database is locked");
  silence.mockRestore();

  const hook = (await runSetup({ sweep: false, sync: false })).checks.find((check) => check.name === "hook")!;
  expect(hook.ok).toBe(false);
  expect(hook.detail).toContain("stop: database is locked");
  expect(hook.fix).toContain(hookLogPath());
});

test("an old hook failure no longer counts", async () => {
  home();
  await Bun.write(hookLogPath(), "2026-01-02T03:04:05.000Z stop: database is locked\n");

  const hook = (await runSetup({ sweep: false, sync: false })).checks.find((check) => check.name === "hook")!;
  expect(hook.ok).toBe(true);
});
