// An ingest writes pages in a separate git worktree, never in the clone the author is reading.
// That way an ingest in progress cannot disturb their working copy, and abandoning it is just
// removing a directory.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface Worktree {
  path: string;
  branch: string;
  created: boolean;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** Returns stdout verbatim: trimming here would silently eat a file's trailing newline. */
function tryGit(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "memory";
}

export function branchName(author: string, slug: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `mem/${slugify(author)}/${date}-${slugify(slug)}`;
}

/** Worktrees live next to the repo, so a stray directory is obvious and easy to delete. */
export function worktreePath(repoPath: string, branch: string): string {
  return join(repoPath, "..", `.dev-memory-worktrees`, branch.replace(/\//g, "-"));
}

export interface EnsureOptions {
  /** Branch the new work starts from. */
  base?: string;
  fetch?: boolean;
}

export function ensureWorktree(repoPath: string, branch: string, options: EnsureOptions = {}): Worktree {
  const path = worktreePath(repoPath, branch);
  const base = options.base ?? "origin/main";

  if (existsSync(join(path, ".git"))) return { path, branch, created: false }; // resume where the author left off

  if (options.fetch !== false) tryGit(repoPath, ["fetch", "origin", "--quiet"]);

  const branchExists = tryGit(repoPath, ["rev-parse", "--verify", `refs/heads/${branch}`]) !== null;
  git(repoPath, branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, base]);
  return { path, branch, created: true };
}

export function removeWorktree(repoPath: string, branch: string): void {
  const path = worktreePath(repoPath, branch);
  if (!existsSync(path)) return;
  git(repoPath, ["worktree", "remove", "--force", path]);
}

export interface ChangedPage {
  path: string;
  status: "added" | "modified" | "deleted";
}

/** What this ingest changed compared with the base branch, which is what the review page lists. */
export function changedPages(worktreePath: string, base = "origin/main"): ChangedPage[] {
  const committed = tryGit(worktreePath, ["diff", "--name-status", `${base}...HEAD`]) ?? "";
  // -uall: without it git reports a brand-new directory as one entry, and the review page would
  // list "wiki/dev-memory/" instead of the pages inside it.
  const uncommitted = tryGit(worktreePath, ["status", "--porcelain", "-uall"]) ?? "";
  const pages = new Map<string, ChangedPage>();

  for (const line of committed.split("\n").filter(Boolean)) {
    const [code, path] = line.split("\t");
    if (!path) continue;
    pages.set(path, { path, status: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified" });
  }

  for (const line of uncommitted.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2);
    const path = line.slice(3).split(" -> ").at(-1)!;
    const status = code.includes("?") ? "added" : code.includes("D") ? "deleted" : "modified";
    pages.set(path, { path, status: pages.get(path)?.status === "added" ? "added" : status });
  }

  return [...pages.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** The version on the base branch, for the diff view. Null when the page is new. */
export function baseVersion(worktreePath: string, path: string, base = "origin/main"): string | null {
  return tryGit(worktreePath, ["show", `${base}:${path}`]);
}
