// Detecting pages that the code has moved past.
//
// A page lists the files it describes in code_refs. If those files changed after the page was
// last updated, the page is probably stale. The check asks GitHub through `gh`, so no other
// repository has to be cloned locally.
import { Glob } from "bun";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { parseFrontmatter } from "./sync";

export interface StaleFinding {
  page: string;
  repo: string;
  path: string;
  updated: string;
  commits: number;
  lastCommit?: string;
}

export interface StaleReport {
  findings: StaleFinding[];
  checked: number;
  skipped: string[];
}

export interface StaleOptions {
  /** Injected in tests; defaults to asking GitHub through gh. */
  commitsSince?: (repo: string, path: string, since: string) => { count: number; last?: string } | null;
}

function ghCommitsSince(repo: string, path: string, since: string): { count: number; last?: string } | null {
  const result = spawnSync(
    "gh",
    ["api", `repos/${repo}/commits?path=${encodeURIComponent(path)}&since=${encodeURIComponent(since)}`, "--jq", ".[].commit.committer.date"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null; // gh missing, not logged in, or no access to that repo

  const dates = result.stdout.split("\n").filter(Boolean);
  return { count: dates.length, last: dates[0] };
}

export async function findStalePages(repo: string, options: StaleOptions = {}): Promise<StaleReport> {
  const commitsSince = options.commitsSince ?? ghCommitsSince;
  const findings: StaleFinding[] = [];
  const skipped: string[] = [];
  let checked = 0;

  for await (const relative of new Glob("wiki/**/*.md").scan({ cwd: repo })) {
    const { frontmatter } = parseFrontmatter(await Bun.file(join(repo, relative)).text());
    const refs = frontmatter.code_refs;
    if (!Array.isArray(refs) || refs.length === 0) continue;

    const updated = frontmatter.updated ? String(frontmatter.updated) : null;
    if (!updated) {
      skipped.push(`${relative}: 沒有 updated，無法判斷過時`);
      continue;
    }
    const since = updated.length === 10 ? `${updated}T00:00:00Z` : updated;

    for (const ref of refs) {
      const repoName = ref?.repo;
      const paths: string[] = Array.isArray(ref?.paths) ? ref.paths : ref?.path ? [ref.path] : [];
      if (!repoName || paths.length === 0) continue;

      for (const path of paths) {
        checked++;
        const result = commitsSince(String(repoName), String(path), since);
        if (result === null) {
          skipped.push(`${repoName}/${path}: 查不到（gh 沒登入或沒有權限）`);
          continue;
        }
        if (result.count > 0) {
          findings.push({ page: relative, repo: String(repoName), path: String(path), updated, commits: result.count, lastCommit: result.last });
        }
      }
    }
  }

  return { findings, checked, skipped: [...new Set(skipped)] };
}

export function formatStale(report: StaleReport): string {
  if (report.checked === 0) return "沒有任何頁面列出 code_refs，沒東西可以檢查。";

  const lines = report.findings.map(
    (finding) =>
      `${finding.page}\n  ${finding.repo}/${finding.path} 在 ${finding.updated} 之後有 ${finding.commits} 個 commit（最後一次 ${finding.lastCommit ?? "?"}）`,
  );
  if (report.skipped.length > 0) {
    lines.push("", "略過：", ...report.skipped.map((reason) => `  ${reason}`));
  }
  lines.push("", `檢查了 ${report.checked} 個檔案，${report.findings.length} 個頁面可能過時。`);
  return lines.join("\n");
}
