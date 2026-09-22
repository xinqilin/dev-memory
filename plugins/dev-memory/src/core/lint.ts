// Structural checks over a memory repo working copy.
//
// The repo's own tools/lint.ts runs the structural rules in CI, where the plugin is not
// installed. The two overlap but are not identical, and neither can import from the other:
//   here only      frontmatter left over from the old layout, a missing H1, a 程式碼位置 table
//                  that stale cannot read, and anything that needs the local index (a cited record
//                  that is not in the repo but is on this machine, a supersedes target that only
//                  exists locally)
//   tools/lint.ts  the JSONL schema and duplicate record ids, which CI must catch on its own
// DOC_DIRS is spelled out in both files on purpose; changing one means changing the other.
//
// Documents are prose, not data: there is no frontmatter and no schema to validate. What can
// break is navigation — a link that points nowhere, or a page README never links to.
import type { Database } from "bun:sqlite";
import { Glob } from "bun";
import { dirname, join } from "node:path";
import { parseCodeRefs } from "./code-refs";
import { readReposYaml } from "./repos";

/** Directories that hold documents. Everything else is tooling or raw material. */
export const DOC_DIRS = ["spec", "maintenance", "guidelines", "config", "dr", "bank", "poc"];

export interface Finding {
  level: "error" | "warning";
  path: string;
  message: string;
}

export interface LintReport {
  findings: Finding[];
  docs: number;
  records: number;
}

interface RepoRecords {
  ids: Set<string>;
  /** id -> the record it claims to replace, for the records that claim to replace one. */
  supersedes: Map<string, { target: string; file: string }>;
}

async function readRecords(repo: string): Promise<RepoRecords> {
  const ids = new Set<string>();
  const supersedes = new Map<string, { target: string; file: string }>();

  for await (const relative of new Glob("records/**/*.jsonl").scan({ cwd: repo })) {
    const text = await Bun.file(join(repo, relative)).text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (!record.id) continue;
        ids.add(String(record.id));
        if (record.supersedes) {
          supersedes.set(String(record.id), { target: String(record.supersedes), file: relative });
        }
      } catch {
        // tools/lint.ts reports malformed lines; here they just do not contribute an id.
      }
    }
  }
  return { ids, supersedes };
}

/** A document's title is its first level-one heading, which is also how sync indexes it. */
function headingOf(text: string): string | null {
  return text.match(/^#\s+(.+)$/m)?.[1].trim() ?? null;
}

export async function lintRepo(db: Database, repo: string): Promise<LintReport> {
  const findings: Finding[] = [];
  const { ids: recordIds, supersedes } = await readRecords(repo);

  const docs: string[] = [];
  for (const dir of DOC_DIRS) {
    for await (const relative of new Glob(`${dir}/**/*.md`).scan({ cwd: repo })) docs.push(relative);
  }

  const byTitle = new Map<string, string[]>();
  // Tables name a repo as owner/repo or by its bare name; both count as declared.
  const declared = new Set([...(await readReposYaml(repo)).values()].flat().flatMap((entry) => [entry.id, entry.id.split("/").at(-1)!]));

  for (const path of docs) {
    const text = await Bun.file(join(repo, path)).text();

    const title = headingOf(text);
    if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), path]);

    if (text.startsWith("---\n")) {
      findings.push({ level: "warning", path, message: "文件開頭有 frontmatter，GitHub 會渲染成一大張表格" });
    }
    if (!/^#\s+\S/m.test(text)) {
      findings.push({ level: "error", path, message: "沒有第一層標題" });
    }

    // Local links must resolve. http(s) and bare anchors are someone else's problem.
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const clean = target.split("#")[0];
      if (!clean) continue;
      const resolved = join(repo, dirname(path), clean);
      if (await Bun.file(resolved).exists()) continue;
      if (await Bun.file(join(resolved, "README.md")).exists()) continue;
      findings.push({ level: "error", path, message: `連結指向不存在的檔案：${target}` });
    }

    // Only a document that has a 程式碼位置 table is held to it; most hand-written ones have none.
    const table = parseCodeRefs(text);
    for (const problem of table?.problems ?? []) findings.push({ level: "warning", path, message: problem });
    for (const name of new Set(table?.refs.map((ref) => ref.repo))) {
      if (declared.size > 0 && !declared.has(name)) {
        findings.push({ level: "warning", path, message: `程式碼位置表的 repo「${name}」不在 repos.yaml 裡` });
      }
    }

    // A document may cite the records behind its "設計考量" section.
    for (const [, id] of text.matchAll(/\b([0-9A-HJKMNP-TV-Z]{26})\b/g)) {
      if (recordIds.has(id)) continue;
      const local = db.query("select id from record where id = ?").get(id);
      if (!local) findings.push({ level: "warning", path, message: `提到的紀錄 ${id} 不在這個 repo 也不在本機索引` });
    }
  }

  // Two documents under the same title are almost always one topic written twice: search returns
  // both, and the next edit lands on whichever one the author happened to open.
  for (const [title, paths] of byTitle) {
    if (paths.length < 2) continue;
    for (const path of paths) {
      const others = paths.filter((other) => other !== path).join("、");
      findings.push({ level: "warning", path, message: `標題「${title}」跟其他文件重複：${others}` });
    }
  }

  // A record that claims to replace another must name one that exists, or the history breaks.
  for (const [id, { target, file }] of supersedes) {
    if (recordIds.has(target)) continue;
    if (db.query("select id from record where id = ?").get(target)) continue;
    findings.push({
      level: "error",
      path: file,
      message: `紀錄 ${id} 的 supersedes 指向不存在的紀錄 ${target}`,
    });
  }

  // README.md is the only index: a document it does not link to is a document nobody finds.
  const readmePath = join(repo, "README.md");
  if (await Bun.file(readmePath).exists()) {
    const readme = await Bun.file(readmePath).text();
    for (const path of docs) {
      if (path.endsWith("/README.md")) continue;
      if (!readme.includes(path)) {
        findings.push({ level: "error", path, message: "README.md 沒有連到這一頁，沒有人會找到它" });
      }
    }
  } else if (docs.length > 0) {
    findings.push({ level: "error", path: "README.md", message: "有文件卻沒有 README.md 索引" });
  }

  return { findings, docs: docs.length, records: recordIds.size };
}

export function formatLint(report: LintReport): string {
  const errors = report.findings.filter((f) => f.level === "error");
  const warnings = report.findings.filter((f) => f.level === "warning");
  return [
    ...warnings.map((f) => `warning  ${f.path}: ${f.message}`),
    ...errors.map((f) => `error    ${f.path}: ${f.message}`),
    "",
    `lint: ${report.docs} docs, ${report.records} records, ${errors.length} errors, ${warnings.length} warnings`,
  ].join("\n");
}
