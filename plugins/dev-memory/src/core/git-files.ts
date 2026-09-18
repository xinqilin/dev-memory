// Which files a session touched. Tool call logs are not enough: Codex edits through
// `exec_command`, so the only reliable source is git itself — the diff from the commit the
// session started on to HEAD, plus whatever is still uncommitted.
import { spawnSync } from "node:child_process";
import { repoIdFromDir } from "./repo-id";

export interface ChangedFile {
  repo: string | null;
  path: string;
  staged: boolean;
  committed: boolean;
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

export function headCommit(cwd: string): string | null {
  return git(cwd, ["rev-parse", "HEAD"])?.trim() ?? null;
}

/**
 * Files changed since `sinceCommit` (usually the HEAD recorded at SessionStart),
 * including uncommitted and untracked work. Outside a git repo the list is empty.
 */
export function changedFiles(cwd: string, sinceCommit?: string | null): ChangedFile[] {
  const repo = repoIdFromDir(cwd);
  const files = new Map<string, ChangedFile>();

  if (sinceCommit) {
    const diff = git(cwd, ["diff", "--name-only", `${sinceCommit}..HEAD`]);
    for (const path of (diff ?? "").split("\n").filter(Boolean)) {
      files.set(path, { repo, path, staged: false, committed: true });
    }
  }

  // Porcelain v1: XY <path>, where X is the index status and Y the worktree status.
  const status = git(cwd, ["status", "--porcelain"]);
  for (const line of (status ?? "").split("\n").filter(Boolean)) {
    const indexStatus = line[0];
    const path = line.slice(3).split(" -> ").at(-1)!; // renames report "old -> new"
    const existing = files.get(path);
    files.set(path, {
      repo,
      path,
      staged: indexStatus !== " " && indexStatus !== "?",
      committed: existing?.committed ?? false,
    });
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
