import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeRemote, repoIdFromCodexSessionMeta, repoIdFromDir } from "../src/core/repo-id";

const ID = "example-org/example-repo";

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

describe("ssh remotes", () => {
  test.each([
    "git@github.com:example-org/example-repo.git",
    "git@github.com:example-org/example-repo",
    "git@github-work:example-org/example-repo.git",
    "ssh://git@github.com/example-org/example-repo.git",
    "ssh://git@github.com:22/example-org/example-repo.git",
    "git@github.com:Example-Org/Example-Repo.git",
  ])("%s", (remote) => {
    expect(normalizeRemote(remote)).toBe(ID);
  });
});

describe("https remotes", () => {
  test.each([
    "https://github.com/example-org/example-repo.git",
    "https://github.com/example-org/example-repo",
    "https://github.com/example-org/example-repo/",
    "https://someone@github.com/example-org/example-repo.git",
    "  https://github.com/example-org/example-repo.git\n",
  ])("%j", (remote) => {
    expect(normalizeRemote(remote)).toBe(ID);
  });

  test("invalid remotes return null", () => {
    expect(normalizeRemote("")).toBeNull();
    expect(normalizeRemote("not a url")).toBeNull();
    expect(normalizeRemote("https://github.com/only-owner")).toBeNull();
  });
});

describe("worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "dev-memory-repo-id-"));
  const main = join(root, "main");
  const worktree = join(root, "feature-wt");
  const plain = join(root, "not-a-repo");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("main checkout and linked worktree resolve to the same ID", () => {
    spawnSync("mkdir", ["-p", main, plain]);
    git(main, "init", "-q");
    git(main, "remote", "add", "origin", "git@github.com:example-org/example-repo.git");
    git(main, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
    git(main, "worktree", "add", "-q", worktree, "-b", "feature");

    expect(repoIdFromDir(main)).toBe(ID);
    expect(repoIdFromDir(worktree)).toBe(ID);
  });

  test("directory outside git returns null", () => {
    expect(repoIdFromDir(plain)).toBeNull();
  });
});

describe("Codex session_meta", () => {
  const meta = (url: unknown) =>
    JSON.stringify({ timestamp: "2026-09-18T00:00:00Z", type: "session_meta", payload: { cwd: "/w", git: { commit_hash: "abc", branch: "main", repository_url: url } } });

  test("reads payload.git.repository_url", () => {
    expect(repoIdFromCodexSessionMeta(meta("git@github.com:example-org/example-repo.git"))).toBe(ID);
    expect(repoIdFromCodexSessionMeta(meta("https://github.com/example-org/example-repo"))).toBe(ID);
  });

  test("other lines, missing git info or bad JSON return null", () => {
    expect(repoIdFromCodexSessionMeta(JSON.stringify({ type: "event_msg", payload: {} }))).toBeNull();
    expect(repoIdFromCodexSessionMeta(meta(undefined))).toBeNull();
    expect(repoIdFromCodexSessionMeta("{")).toBeNull();
  });
});

test("all four sources agree", () => {
  const root = mkdtempSync(join(tmpdir(), "dev-memory-repo-id-all-"));
  try {
    const main = join(root, "main");
    spawnSync("mkdir", ["-p", main]);
    git(main, "init", "-q");
    git(main, "remote", "add", "origin", "https://github.com/example-org/example-repo.git");
    git(main, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
    git(main, "worktree", "add", "-q", join(root, "wt"), "-b", "wt");

    const ids = new Set([
      normalizeRemote("git@github.com:example-org/example-repo.git"),
      normalizeRemote("https://github.com/example-org/example-repo.git"),
      repoIdFromDir(join(root, "wt")),
      repoIdFromCodexSessionMeta(JSON.stringify({ type: "session_meta", payload: { git: { repository_url: "git@github.com:example-org/example-repo.git" } } })),
    ]);
    expect([...ids]).toEqual([ID]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
