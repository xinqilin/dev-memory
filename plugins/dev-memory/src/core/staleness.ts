// Detecting documents that the code has moved past.
//
// A document ends with a 程式碼位置 table: what it covers, which repo, which branch, which path.
// If any of those paths changed on that branch after the document's own last commit, or no longer
// exists there, the document is probably stale. The code is read from local clones (config.toml
// [repos]), so this needs no network and no GitHub login — and sees only what was last fetched.
import { Glob } from "bun";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { type CodeRef, parseCodeRefs } from "./code-refs";
import { DOC_DIRS } from "./lint";
import { readReposYaml, resolveRepos } from "./repos";

export interface StaleFinding extends CodeRef {
  doc: string;
  /** The document's last commit, which is when it last agreed with the code. */
  since: string;
  /** "hash subject（date）", newest first. */
  commits: string[];
  /** The path is gone from that branch: renamed, moved or deleted. */
  missing: boolean;
}

export interface StaleReport {
  findings: StaleFinding[];
  /** Paths actually compared. */
  checked: number;
  /** Repos or branches that could not be looked at, with why. */
  unreachable: string[];
  /** Documents with no 程式碼位置 table, which cannot be judged at all. */
  withoutTable: number;
}

export interface StaleOptions {
  /** Local clone for each repo name a table uses; null when it is not on this machine. */
  clones?: Map<string, string | null>;
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Tables name a repo either as owner/repo or, more often, by its bare name. */
async function clonesFromConfig(memoryRepo: string): Promise<Map<string, string | null>> {
  const entries = [...(await readReposYaml(memoryRepo)).values()].flat();
  const clones = new Map<string, string | null>();
  for (const repo of await resolveRepos(entries)) {
    clones.set(repo.id, repo.path);
    clones.set(repo.id.split("/").at(-1)!, repo.path);
  }
  return clones;
}

export async function findStaleDocs(repo: string, options: StaleOptions = {}): Promise<StaleReport> {
  const clones = options.clones ?? (await clonesFromConfig(repo));
  const report: StaleReport = { findings: [], checked: 0, unreachable: [], withoutTable: 0 };
  const unreachable = new Set<string>();

  const docs: string[] = [];
  for (const dir of DOC_DIRS) {
    for await (const relative of new Glob(`${dir}/**/*.md`).scan({ cwd: repo })) docs.push(relative);
  }

  for (const doc of docs.sort()) {
    const table = parseCodeRefs(await Bun.file(join(repo, doc)).text());
    if (!table || table.refs.length === 0) {
      report.withoutTable++;
      continue;
    }
    const since = git(repo, ["log", "-1", "--format=%cI", "--", doc]);
    if (!since) continue; // not committed yet: it is being written right now

    for (const ref of table.refs) {
      const clone = clones.get(ref.repo);
      if (clone === undefined) {
        unreachable.add(`${ref.repo}：repos.yaml 裡沒有這個 repo`);
        continue;
      }
      if (clone === null) {
        unreachable.add(`${ref.repo}：這台機器上找不到 clone`);
        continue;
      }
      const branch = [`origin/${ref.branch}`, ref.branch].find((name) => git(clone, ["rev-parse", "--verify", "--quiet", name]) !== null);
      if (!branch) {
        unreachable.add(`${ref.repo}：沒有 ${ref.branch} 分支（先 git fetch）`);
        continue;
      }

      report.checked++;
      const present = git(clone, ["ls-tree", "-r", "--name-only", branch, "--", ref.path]);
      const log = git(clone, ["log", branch, `--since=${since}`, "--format=%h %s（%cs）", "--", ref.path]) ?? "";
      const commits = log.split("\n").filter(Boolean);
      const missing = !present;
      if (missing || commits.length > 0) report.findings.push({ doc, ...ref, since, commits, missing });
    }
  }

  report.unreachable = [...unreachable];
  return report;
}

export function formatStale(report: StaleReport): string {
  if (report.checked === 0 && report.unreachable.length === 0) return "沒有任何文件有程式碼位置表，沒東西可以檢查。";

  const lines: string[] = [];
  if (report.findings.length > 0) {
    lines.push("程式碼在文件之後改過：");
    let doc = "";
    for (const finding of report.findings) {
      if (finding.doc !== doc) lines.push(`  ${(doc = finding.doc)}（${finding.since.slice(0, 10)}）`);
      lines.push(`    ${finding.repo}@${finding.branch}  ${finding.path}`);
      if (finding.missing) lines.push("      這個路徑在分支上已經不存在：改名、搬走或刪掉了");
      for (const commit of finding.commits.slice(0, 5)) lines.push(`      ${commit}`);
      if (finding.commits.length > 5) lines.push(`      …還有 ${finding.commits.length - 5} 個`);
    }
  }
  if (report.unreachable.length > 0) {
    lines.push("", "查不到：", ...report.unreachable.map((reason) => `  ${reason}`), "  → dev-memory repos 會印出要在 config.toml 補哪一行");
  }
  if (report.withoutTable > 0) lines.push("", `無法判斷：${report.withoutTable} 份文件沒有程式碼位置表`);

  const stale = new Set(report.findings.map((finding) => finding.doc)).size;
  lines.push("", `檢查了 ${report.checked} 個路徑，${stale} 份文件可能過時。以本機 clone 為準，先 git fetch 才看得到最新的 commit。`);
  return lines.join("\n").replace(/^\n/, "");
}
