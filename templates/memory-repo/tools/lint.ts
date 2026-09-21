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
// The plugin's src/core/lint.ts spells this out too: CI runs without the plugin installed, so
// neither file can import from the other. Changing one means changing the other.
const DOC_DIRS = ["spec", "maintenance", "guidelines", "config", "dr", "bank", "poc"];

const problems: string[] = [];
const warnings: string[] = [];
const fail = (file: string, message: string) => problems.push(`${file}: ${message}`);
const warn = (file: string, message: string) => warnings.push(`${file}: ${message}`);

const root = process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : ".";
const rel = (path: string) => relative(root, path) || path;

// ---------- records ----------
const recordIds = new Set<string>();
const supersedes = new Map<string, { target: string; where: string }>();

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
    if (id && record.supersedes) supersedes.set(id, { target: String(record.supersedes), where });
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

// A record that claims to replace another must name one that exists. CI only sees the repo, so
// a target that exists solely in someone's local index still fails here — as it should: the
// history has to hold together for everyone, not just for the author.
for (const [id, { target, where }] of supersedes) {
  if (!recordIds.has(target)) fail(where, `supersedes points at a record that is not in this repo: ${target}`);
}

// ---------- duplicate titles ----------
// Two documents under the same heading are one topic written twice: search returns both, and
// the next edit lands on whichever one the author happened to open.
const byTitle = new Map<string, string[]>();
for (const file of docs) {
  const title = (await Bun.file(join(root, file)).text()).match(/^#\s+(.+)$/m)?.[1].trim();
  if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), file]);
}
for (const [title, files] of byTitle) {
  if (files.length < 2) continue;
  for (const file of files) warn(file, `title "${title}" is also used by ${files.filter((f) => f !== file).join(", ")}`);
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
