// Structural and source checks over a memory repo working copy.
//
// The repo's own tools/lint.ts runs the same structural rules in CI, where the plugin is not
// installed. This one runs on the author's machine, so it can additionally check what only the
// local index knows: whether a page's sources[] point at records that really exist, and whether
// the page looks like it came from them.
import type { Database } from "bun:sqlite";
import { Glob } from "bun";
import { join } from "node:path";
import { parseFrontmatter } from "./sync";
import { queryTerms } from "./tokenize";

export interface Finding {
  level: "error" | "warning";
  path: string;
  message: string;
}

export interface LintReport {
  findings: Finding[];
  pages: number;
  records: number;
}

interface PageInfo {
  path: string;
  slug: string;
  frontmatter: Record<string, any>;
  body: string;
}

async function readPages(repo: string): Promise<PageInfo[]> {
  const pages: PageInfo[] = [];
  for await (const relative of new Glob("wiki/**/*.md").scan({ cwd: repo })) {
    if (/\/(index|log)\.md$/.test(relative) || relative === "wiki/index.md" || relative === "wiki/log.md") continue;
    const text = await Bun.file(join(repo, relative)).text();
    const { frontmatter, body } = parseFrontmatter(text);
    pages.push({ path: relative, slug: relative.split("/").at(-1)!.replace(/\.md$/, ""), frontmatter, body });
  }
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

async function readRecordIds(repo: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for await (const relative of new Glob("records/**/*.jsonl").scan({ cwd: repo })) {
    for (const line of (await Bun.file(join(repo, relative)).text()).split("\n")) {
      if (!line.trim()) continue;
      try {
        const id = JSON.parse(line).id;
        if (id) ids.add(String(id));
      } catch {
        // tools/lint.ts reports the broken line; nothing to add here
      }
    }
  }
  return ids;
}

/** Does the page share any wording with the records it claims to come from? */
function looksTraceable(page: PageInfo, sourceTexts: string[]): boolean {
  if (sourceTexts.length === 0) return true; // nothing to compare against
  const title = String(page.frontmatter.title ?? "");
  const terms = queryTerms(title).filter((term) => term.length >= 2);
  if (terms.length === 0) return true;
  const haystack = sourceTexts.join("\n").toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

export async function lintRepo(db: Database, repo: string): Promise<LintReport> {
  const pages = await readPages(repo);
  const repoRecordIds = await readRecordIds(repo);
  const slugs = new Set(pages.map((page) => page.slug));
  const findings: Finding[] = [];

  const index = (await Bun.file(join(repo, "wiki", "index.md")).exists())
    ? await Bun.file(join(repo, "wiki", "index.md")).text()
    : "";

  const bySlug = new Map(pages.map((page) => [page.slug, page]));

  for (const page of pages) {
    const { frontmatter } = page;

    // links
    for (const [, target] of `${JSON.stringify(frontmatter.related ?? [])}\n${page.body}`.matchAll(/\[\[([^\]]+)\]\]/g)) {
      if (!slugs.has(target)) findings.push({ level: "error", path: page.path, message: `連到不存在的頁面 [[${target}]]` });
    }
    for (const [, target] of page.body.matchAll(/\]\(([^)]+\.md)\)/g)) {
      if (target.startsWith("http")) continue;
      const resolved = join(repo, page.path, "..", target);
      if (!(await Bun.file(resolved).exists())) {
        findings.push({ level: "error", path: page.path, message: `連到不存在的檔案 ${target}` });
      }
    }

    // orphans
    if (!index.includes(page.path.replace(/^wiki\//, "")) && !index.includes(`[[${page.slug}]]`)) {
      findings.push({ level: "warning", path: page.path, message: "沒有被 wiki/index.md 連到，沒有人會找到這頁" });
    }

    // superseding
    if (frontmatter.status === "superseded") {
      const target = String(frontmatter.superseded_by ?? "");
      if (!target) findings.push({ level: "error", path: page.path, message: "標成 superseded 但沒有填 superseded_by" });
      else if (!slugs.has(target.replace(/\[\[|\]\]/g, ""))) {
        findings.push({ level: "error", path: page.path, message: `superseded_by 指向不存在的頁面 ${target}` });
      }
    }

    // sources: the check borrowed from llm_wiki's citation rule
    const sources = Array.isArray(frontmatter.sources) ? frontmatter.sources.map(String) : [];
    if (sources.length === 0) {
      findings.push({ level: "warning", path: page.path, message: "沒有 sources[]，內容無法追回任何一筆紀錄" });
    }

    const sourceTexts: string[] = [];
    for (const id of sources) {
      const local = db.query("select title, body from record where id = ?").get(id) as { title: string; body: string } | null;
      if (local) sourceTexts.push(`${local.title}\n${local.body}`);
      if (!local && !repoRecordIds.has(id)) {
        findings.push({ level: "error", path: page.path, message: `sources[] 指向不存在的紀錄 ${id}` });
      }
    }
    if (sources.length > 0 && sourceTexts.length > 0 && !looksTraceable(page, sourceTexts)) {
      findings.push({
        level: "warning",
        path: page.path,
        message: "標題跟列出的來源紀錄沒有共同用字，可能引錯來源（請人工確認）",
      });
    }
  }

  // two active pages claiming the same title is the cheap, deterministic half of
  // "contradicting decisions"; the semantic half is the agent's job in /wiki-lint.
  const byTitle = new Map<string, PageInfo[]>();
  for (const page of pages) {
    if (page.frontmatter.status === "superseded") continue;
    const title = String(page.frontmatter.title ?? "").trim();
    if (!title) continue;
    byTitle.set(title, [...(byTitle.get(title) ?? []), page]);
  }
  for (const [title, sharing] of byTitle) {
    if (sharing.length < 2) continue;
    for (const page of sharing) {
      findings.push({
        level: "warning",
        path: page.path,
        message: `跟其他頁同名而且都還是 active：${sharing.filter((p) => p !== page).map((p) => p.path).join(", ")}（${title}）`,
      });
    }
  }

  void bySlug;
  return { findings, pages: pages.length, records: repoRecordIds.size };
}

export function formatLint(report: LintReport): string {
  const errors = report.findings.filter((f) => f.level === "error");
  const warnings = report.findings.filter((f) => f.level === "warning");
  const lines = [
    ...warnings.map((f) => `warning  ${f.path}: ${f.message}`),
    ...errors.map((f) => `error    ${f.path}: ${f.message}`),
    "",
    `lint: ${report.pages} pages, ${report.records} records, ${errors.length} errors, ${warnings.length} warnings`,
  ];
  return lines.join("\n");
}
