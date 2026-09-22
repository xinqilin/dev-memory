// An ingest writes pages in a separate git worktree, never in the clone the author is reading.
// That way an ingest in progress cannot disturb their working copy. Abandoning one is not just
// removing a directory, though: its cards were marked submitted when exported, so discardIngest
// hands them back first.
import type { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addedRecordIds, isRecordsPath, returnToLocal } from "./export";

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

export interface DiscardResult {
  status: "discarded" | "pushed" | "missing";
  /** Cards moved back to local, so the next ingest carries them. */
  returned: number;
}

/** Throw an ingest away: hand its cards back, then remove the worktree and the local branch. */
export function discardIngest(repoPath: string, branch: string, db: Database, base = "origin/main"): DiscardResult {
  const hasBranch = tryGit(repoPath, ["rev-parse", "--verify", `refs/heads/${branch}`]) !== null;
  if (!hasBranch && !existsSync(join(worktreePath(repoPath, branch), ".git"))) return { status: "missing", returned: 0 };

  // Pushed means its cards are in a PR. Handing them back would export them a second time, and
  // if that PR were merged later the same id would land in the repo twice.
  if (tryGit(repoPath, ["rev-parse", "--verify", `refs/remotes/origin/${branch}`]) !== null) return { status: "pushed", returned: 0 };

  // A worktree deleted by hand is recreated from its branch, so its cards can still be counted.
  const { path } = ensureWorktree(repoPath, branch, { base, fetch: false });
  const ids = changedPages(path, base)
    .filter((page) => page.status !== "deleted" && isRecordsPath(page.path))
    .flatMap((page) => addedRecordIds(readFileSync(join(path, page.path), "utf8"), baseVersion(path, page.path, base)));
  const returned = returnToLocal(db, ids);

  removeWorktree(repoPath, branch);
  git(repoPath, ["branch", "-D", branch]);
  return { status: "discarded", returned };
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
