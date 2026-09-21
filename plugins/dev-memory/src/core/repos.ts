// Where the code lives on this machine.
//
// repos.yaml (in the memory repo) says which repos a product has; it is shared with the whole
// team, so it must not contain anyone's local paths. This module answers the other half —
// "where is 104corp/foo on *this* laptop" — from ~/.dev-memory/config.toml, falling back to a
// scan of the usual places so most people never have to configure anything.
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { configPath, loadConfig } from "./config";
import { repoIdFromDir } from "./repo-id";

export interface RepoEntry {
  id: string;
  /**
   * Refs to look in, best first. There is no single right answer across a team's repos:
   * one has dev ahead of master, another has master ahead of dev, a third keeps each job
   * on its own branch. So the repo declares its order and the writer reports what it used.
   */
  refs: string[];
  defaultBranch: string;
  /** The module for a job lives on its own branch, not on the default one. */
  branchPerJob: boolean;
  jobBranchPrefix: string;
}

export interface ResolvedRepo extends RepoEntry {
  path: string | null;
  /** How we found it, so `dev-memory repos` can explain itself. */
  via: "config" | "scan" | null;
}

/** Directories people actually keep checkouts in. Cheap to scan, one level deep. */
const SEARCH_ROOTS = ["project-backend", "project-frontend", "project-other", "projects", "src", "code", "work", "dev"];

export async function readReposYaml(memoryRepo: string): Promise<Map<string, RepoEntry[]>> {
  const file = Bun.file(join(memoryRepo, "repos.yaml"));
  if (!(await file.exists())) return new Map();

  const parsed = (Bun.YAML.parse(await file.text()) ?? {}) as {
    products?: Record<string, { repos?: unknown[] }>;
  };

  const byProduct = new Map<string, RepoEntry[]>();
  for (const [product, value] of Object.entries(parsed.products ?? {})) {
    const entries: RepoEntry[] = [];
    for (const item of value?.repos ?? []) {
      // Both shapes are allowed: a bare "owner/repo" string, or a table with branch hints.
      const raw = typeof item === "string" ? { id: item } : (item as Record<string, unknown>);
      const id = String(raw.id ?? "").trim();
      if (!id) continue;
      const declared = Array.isArray(raw.refs) ? raw.refs.map(String).filter(Boolean) : [];
      const fallback = String(raw.default_branch ?? "main");
      entries.push({
        id,
        refs: declared.length > 0 ? declared : [fallback],
        defaultBranch: declared[0] ?? fallback,
        branchPerJob: raw.branch_per_job === true,
        jobBranchPrefix: String(raw.job_branch_prefix ?? "batch/"),
      });
    }
    byProduct.set(product, entries);
  }
  return byProduct;
}

/** One level of directories under each search root, oldest-fashioned way: just look. */
function* candidateDirs(): Generator<string> {
  const home = homedir();
  for (const root of SEARCH_ROOTS) {
    const base = join(home, root);
    let names: string[];
    try {
      names = readdirSync(base);
    } catch {
      continue; // root does not exist on this machine
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const path = join(base, name);
      try {
        if (statSync(path).isDirectory()) yield path;
      } catch {
        // a broken symlink is not a checkout
      }
    }
  }
}

/** owner/repo -> local path, for every checkout found in the usual places. */
export function scanForRepos(): Map<string, string> {
  const found = new Map<string, string>();
  for (const path of candidateDirs()) {
    const id = repoIdFromDir(path);
    if (id && !found.has(id)) found.set(id, path);
  }
  return found;
}

export async function resolveRepos(entries: RepoEntry[]): Promise<ResolvedRepo[]> {
  const configured = (await loadConfig()).repos;
  // Only scan when something is actually missing: walking the disk is not free.
  const needsScan = entries.some((entry) => !configured[entry.id]);
  const scanned = needsScan ? scanForRepos() : new Map<string, string>();

  return entries.map((entry) => {
    if (configured[entry.id]) return { ...entry, path: configured[entry.id], via: "config" as const };
    const hit = scanned.get(entry.id);
    return hit ? { ...entry, path: hit, via: "scan" as const } : { ...entry, path: null, via: null };
  });
}

/** The exact lines to paste into config.toml for everything that is still missing. */
export function configSuggestion(resolved: ResolvedRepo[]): string | null {
  const missing = resolved.filter((repo) => repo.path === null);
  if (missing.length === 0) return null;
  return [
    "[repos]",
    ...missing.map((repo) => `"${repo.id}" = "~/你 clone 的位置/${repo.id.split("/").at(-1)}"`),
  ].join("\n");
}

/**
 * Write resolved paths into config.toml's [repos] block.
 *
 * Detection is a convenience, not a contract: once a path is written down, a moved or renamed
 * checkout produces a clear error instead of silently resolving to something else.
 * Bun parses TOML but cannot serialize it, so the block is edited line by line.
 */
export async function saveRepoPaths(resolved: ResolvedRepo[]): Promise<number> {
  const found = resolved.filter((repo) => repo.path !== null);
  if (found.length === 0) return 0;

  const path = configPath();
  const text = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  const lines = text.split("\n");

  const entries = new Map(found.map((repo) => [repo.id, repo.path as string]));
  const out: string[] = [];
  let inRepos = false;
  let sawRepos = false;

  for (const line of lines) {
    if (line.trim().startsWith("[")) {
      if (inRepos) {
        // Leaving the block: flush whatever was not already present.
        for (const [id, dir] of entries) out.push(`"${id}" = "${dir}"`);
        entries.clear();
      }
      inRepos = line.trim() === "[repos]";
      if (inRepos) sawRepos = true;
    } else if (inRepos) {
      const id = line.match(/^\s*"([^"]+)"\s*=/)?.[1];
      if (id && entries.has(id)) {
        out.push(`"${id}" = "${entries.get(id)}"`);
        entries.delete(id);
        continue;
      }
    }
    out.push(line);
  }

  if (!sawRepos) out.push("", "[repos]");
  for (const [id, dir] of entries) out.push(`"${id}" = "${dir}"`);

  await Bun.write(path, `${out.join("\n").trimEnd()}\n`);
  return found.length;
}
