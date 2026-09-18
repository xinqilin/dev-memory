#!/usr/bin/env bun
// Structural lint for a memory repo. Self-contained on purpose: it runs in CI where the
// plugin is not installed, so it must work with nothing but bun.
//
//   bun tools/lint.ts            # lint wiki/ and records/ in the current directory
//   bun tools/lint.ts --root .   # same, explicit
//
// Exits 1 when anything is wrong. Existing hand-written docs outside wiki/ are never touched.
import { Glob } from "bun";
import { join, relative } from "node:path";

const RECORD_PATH = /^records\/[a-z0-9-]+\/\d{4}-\d{2}\/[^/]+\.jsonl$/;
const REQUIRED_RECORD_FIELDS = ["id", "author", "host", "type", "title", "body", "content_hash", "created_at"];
const PAGE_TYPES = new Set(["overview", "feature", "decision", "entity", "repo", "runbook"]);
const PAGE_STATUS = new Set(["active", "superseded"]);

const problems: string[] = [];
const warnings: string[] = [];
const fail = (file: string, message: string) => problems.push(`${file}: ${message}`);
const warn = (file: string, message: string) => warnings.push(`${file}: ${message}`);

const root = process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : ".";
const rel = (path: string) => relative(root, path) || path;

// ---------- records ----------
const recordIds = new Set<string>();

for await (const path of new Glob("records/**/*.jsonl").scan({ cwd: root, absolute: true })) {
  const file = rel(path);
  if (!RECORD_PATH.test(file)) {
    fail(file, "path must be records/<product>/<yyyy-mm>/<author>.jsonl");
  }

  const lines = (await Bun.file(path).text()).split("\n");
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const where = `${file}:${index + 1}`;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(where, `not valid JSON (${error})`);
      return;
    }

    for (const field of REQUIRED_RECORD_FIELDS) {
      if (!record[field]) fail(where, `missing "${field}"`);
    }
    const id = String(record.id ?? "");
    if (id) {
      if (recordIds.has(id)) fail(where, `duplicate id ${id}`);
      recordIds.add(id);
    }
    if (record.content_hash && !String(record.content_hash).startsWith("sha256:")) {
      fail(where, "content_hash must start with sha256:");
    }
  });
}

// ---------- wiki ----------
interface Page {
  file: string;
  slug: string;
  frontmatter: Record<string, any>;
  body: string;
}

const pages: Page[] = [];

for await (const path of new Glob("wiki/**/*.md").scan({ cwd: root, absolute: true })) {
  const file = rel(path);
  const text = await Bun.file(path).text();
  const slug = file.split("/").at(-1)!.replace(/\.md$/, "");

  if (slug === "index" || slug === "log") continue; // navigation files have no frontmatter

  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    fail(file, "missing YAML frontmatter");
    continue;
  }

  let frontmatter: Record<string, any>;
  try {
    frontmatter = (Bun.YAML.parse(match[1]) ?? {}) as Record<string, any>;
  } catch (error) {
    fail(file, `frontmatter is not valid YAML (${error})`);
    continue;
  }

  pages.push({ file, slug, frontmatter, body: match[2] });
}

const pageSlugs = new Set(pages.map((page) => page.slug));

for (const page of pages) {
  const { file, frontmatter } = page;
  for (const field of ["type", "title", "status", "updated"]) {
    if (!frontmatter[field]) fail(file, `frontmatter missing "${field}"`);
  }
  if (frontmatter.type && !PAGE_TYPES.has(frontmatter.type)) fail(file, `unknown type "${frontmatter.type}"`);
  if (frontmatter.status && !PAGE_STATUS.has(frontmatter.status)) fail(file, `unknown status "${frontmatter.status}"`);
  if (frontmatter.status === "superseded" && !frontmatter.superseded_by) {
    fail(file, "superseded pages need superseded_by");
  }

  const sources = frontmatter.sources ?? [];
  if (!Array.isArray(sources) || sources.length === 0) {
    warn(file, "no sources[]: a page nobody can trace back is hard to trust");
  } else if (recordIds.size > 0) {
    for (const source of sources) {
      if (!recordIds.has(String(source))) fail(file, `sources[] points at a record that does not exist: ${source}`);
    }
  }

  // [[wikilinks]] in frontmatter and body must resolve to a page in this repo.
  const links = `${JSON.stringify(frontmatter.related ?? [])}\n${page.body}`.matchAll(/\[\[([^\]]+)\]\]/g);
  for (const [, target] of links) {
    if (!pageSlugs.has(target)) fail(file, `broken link [[${target}]]`);
  }
}

// ---------- index ----------
const indexPath = join(root, "wiki", "index.md");
if (await Bun.file(indexPath).exists()) {
  const index = await Bun.file(indexPath).text();
  for (const page of pages) {
    const linked = index.includes(page.file.replace(/^wiki\//, "")) || index.includes(`[[${page.slug}]]`);
    if (!linked) warn(page.file, "not linked from wiki/index.md (orphan page)");
  }
} else if (pages.length > 0) {
  fail("wiki/index.md", "missing, but there are wiki pages");
}

// ---------- report ----------
for (const warning of warnings) console.warn(`warning  ${warning}`);
for (const problem of problems) console.error(`error    ${problem}`);

console.log(
  `\nlint: ${pages.length} pages, ${recordIds.size} records, ${problems.length} errors, ${warnings.length} warnings`,
);
process.exit(problems.length > 0 ? 1 : 0);
