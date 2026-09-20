// Structural checks over a memory repo working copy.
//
// The repo's own tools/lint.ts runs the same rules in CI, where the plugin is not installed.
// This one runs on the author's machine, so it can additionally check what only the local index
// knows: whether the records a document cites still exist.
//
// Documents are prose, not data: there is no frontmatter and no schema to validate. What can
// break is navigation — a link that points nowhere, or a page README never links to.
import type { Database } from "bun:sqlite";
import { Glob } from "bun";
import { dirname, join } from "node:path";

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

async function readRecordIds(repo: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for await (const relative of new Glob("records/**/*.jsonl").scan({ cwd: repo })) {
    const text = await Bun.file(join(repo, relative)).text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const id = JSON.parse(line).id;
        if (id) ids.add(String(id));
      } catch {
        // tools/lint.ts reports malformed lines; here they just do not contribute an id.
      }
    }
  }
  return ids;
}

export async function lintRepo(db: Database, repo: string): Promise<LintReport> {
  const findings: Finding[] = [];
  const recordIds = await readRecordIds(repo);

  const docs: string[] = [];
  for (const dir of DOC_DIRS) {
    for await (const relative of new Glob(`${dir}/**/*.md`).scan({ cwd: repo })) docs.push(relative);
  }

  for (const path of docs) {
    const text = await Bun.file(join(repo, path)).text();

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

    // A document may cite the records behind its "設計考量" section.
    for (const [, id] of text.matchAll(/\b([0-9A-HJKMNP-TV-Z]{26})\b/g)) {
      if (recordIds.has(id)) continue;
      const local = db.query("select id from record where id = ?").get(id);
      if (!local) findings.push({ level: "warning", path, message: `提到的紀錄 ${id} 不在這個 repo 也不在本機索引` });
    }
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
