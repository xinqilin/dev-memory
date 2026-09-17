// Normalizes git remotes from every source into one repo ID: "owner/repo" (lowercase).
// The host is dropped on purpose so SSH host aliases (git@github-work:...) map to the same ID.
// Lowercase because GitHub owner/repo names are case-insensitive.

import { spawnSync } from "node:child_process";

export function normalizeRemote(remote: string): string | null {
  const url = remote.trim();
  let path: string | undefined;

  const scp = url.match(/^[^/@\s]+@[^:/\s]+:(.+)$/); // git@github.com:owner/repo.git
  if (scp) {
    path = scp[1];
  } else {
    try {
      path = new URL(url).pathname; // ssh://, https://, git://
    } catch {
      return null;
    }
  }

  const parts = path.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts.at(-2)}/${parts.at(-1)}`.toLowerCase();
}

// Works for normal clones and linked worktrees alike: worktrees share the main repo's config.
export function repoIdFromDir(dir: string): string | null {
  const result = spawnSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return normalizeRemote(result.stdout);
}

// Accepts one line of a Codex rollout JSONL; only the session_meta line carries git info.
export function repoIdFromCodexSessionMeta(line: string): string | null {
  let entry: any;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (entry?.type !== "session_meta") return null;
  const url = entry.payload?.git?.repository_url;
  return typeof url === "string" ? normalizeRemote(url) : null;
}
