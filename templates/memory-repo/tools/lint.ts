#!/usr/bin/env bun
// Structural lint for a memory repo. Self-contained on purpose: it runs in CI where the
// plugin is not installed, so it must work with nothing but bun.
//
//   bun tools/lint.ts            # lint the docs and records/ in the current directory
//   bun tools/lint.ts --root .   # same, explicit
//
// Exits 1 when anything is wrong.
import { Glob } from "bun";
import { join, relative } from "node:path";

const RECORD_PATH = /^records\/[a-z0-9-]+\/\d{4}-\d{2}\/[^/]+\.jsonl$/;
const REQUIRED_RECORD_FIELDS = ["id", "author", "host", "type", "title", "body", "content_hash", "created_at"];
// Directories that hold documents. Everything else (records/, tools/, .github/) is not a doc.
const DOC_DIRS = ["spec", "maintenance", "guidelines", "config", "dr", "bank", "poc"];

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


// ---------- documents ----------
// A doc is a .md under one of DOC_DIRS. Two things must hold: every relative link resolves,
// and README.md links to it — an unindexed page is a page nobody finds.
const docs: string[] = [];
for (const dir of DOC_DIRS) {
  for await (const path of new Glob(`${dir}/**/*.md`).scan({ cwd: root, absolute: true })) {
    docs.push(rel(path));
  }
}

for (const file of docs) {
  const text = await Bun.file(join(root, file)).text();
  const dir = file.split("/").slice(0, -1).join("/");

  // [text](./target.md#anchor) — only local targets; http(s) and bare anchors are someone else's problem.
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split("#")[0];
    if (!clean) continue;
    const resolved = join(root, dir, clean);
    if (!(await Bun.file(resolved).exists())) {
      const asDir = await Bun.file(join(resolved, "README.md")).exists();
      if (!asDir) fail(file, `broken link: ${target}`);
    }
  }
}

// ---------- index ----------
const readmePath = join(root, "README.md");
if (await Bun.file(readmePath).exists()) {
  const readme = await Bun.file(readmePath).text();
  for (const file of docs) {
    if (file.endsWith("/README.md")) continue; // a directory's own index
    if (!readme.includes(file)) fail(file, "not linked from README.md — nobody will find it");
  }
} else if (docs.length > 0) {
  fail("README.md", "missing, but there are documents");
}

// ---------- report ----------
for (const warning of warnings) console.warn(`warning  ${warning}`);
for (const problem of problems) console.error(`error    ${problem}`);

console.log(`\nlint: ${docs.length} docs, ${recordIds.size} records, ${problems.length} errors, ${warnings.length} warnings`);
process.exit(problems.length > 0 ? 1 : 0);
