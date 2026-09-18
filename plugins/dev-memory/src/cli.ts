#!/usr/bin/env bun
// dev-memory CLI. Everything the hooks and skills do goes through here, so both tools behave alike.
import { parseArgs } from "node:util";
import type { Host } from "./adapters/types";
import { archiveFile, sweep, totals } from "./core/archive";
import { configPath, dbPath, ensureConfig, homeDir, loadConfig } from "./core/config";
import { hasFts5, openDb, schemaVersion, sqliteVersion } from "./core/db";
import { formatReport, parseCases, runEval } from "./core/eval";
import { initRepo } from "./core/init-repo";
import { sync as syncRepo } from "./core/sync";
import { repoIdFromDir } from "./core/repo-id";
import { type RecordInput, addRecord, contentHash, findByContentHash } from "./core/record";
import { type Kind, get, search } from "./core/search";

const USAGE = `dev-memory

Usage:
  dev-memory init                     Create ~/.dev-memory, the local index and the config
  dev-memory archive <file> [--host]  Archive new lines of one transcript (host is inferred from the path)
  dev-memory sweep                    Archive every transcript of both tools
  dev-memory search <query>           Keyword search (--repo, --kind, --limit, --json)
  dev-memory get <kind> <ref>         Print the full text behind a search hit
  dev-memory record                   Save one record; reads its JSON from stdin
  dev-memory eval <file.yaml>         Measure retrieval against a case file (--limit, --json)
  dev-memory init-repo <dir>          Add the memory repo scaffolding to an existing repository
  dev-memory sync                     Import the memory repo's main branch into the local index (--repo, --no-fetch)
`;

/** The mem-save skill pipes JSON in, which avoids quoting a multi-line body on a command line. */
async function addRecordFromStdin(): Promise<number> {
  const raw = await Bun.stdin.text();
  let input: RecordInput;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    console.error(`record expects JSON on stdin: ${error}`);
    return 2;
  }
  if (!input?.type || !input?.title || !input?.body) {
    console.error('record needs at least {"type":"decision","title":"…","body":"…"}');
    return 2;
  }

  const db = openDb();
  try {
    const existing = findByContentHash(db, contentHash(input));
    if (existing) {
      console.log(`already saved as ${existing}`);
      return 0;
    }
    const record = addRecord(db, input);
    console.log(`saved ${record.id} (${record.type}) ${record.title}`);
    console.log(`author ${record.author}  repos ${record.repos.join(", ") || "none"}  branch ${record.branch ?? "none"}`);
    return 0;
  } finally {
    db.close();
  }
}

async function runSync(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, fetch: { type: "boolean", default: true } } });
  const config = await loadConfig();
  const repo = values.repo ?? config.memory.repo;
  if (!repo) {
    console.error("No memory repo configured. Set memory.repo in ~/.dev-memory/config.toml, or pass --repo <path>.");
    return 2;
  }

  const db = openDb();
  try {
    const result = syncRepo(db, repo, { branch: config.memory.branch, fetch: values.fetch });
    console.log(
      `records: ${result.records.imported} imported, ${result.records.alreadyThere} already here` +
        (result.records.markedMerged ? ` (${result.records.markedMerged} of mine are now on ${config.memory.branch})` : ""),
    );
    console.log(`pages:   ${result.pages.imported} indexed, ${result.pages.removed} removed`);
    return 0;
  } catch (error) {
    console.error(`sync failed: ${error instanceof Error ? error.message : error}`);
    return 1;
  } finally {
    db.close();
  }
}

async function runInitRepo(args: string[]): Promise<number> {
  const target = args[0];
  if (!target) {
    console.error("init-repo needs the path of the repository to set up");
    return 2;
  }

  const { created, kept } = await initRepo(target);
  for (const file of created) console.log(`created  ${file}`);
  for (const file of kept) console.log(`kept     ${file}`);
  console.log(`\n${created.length} added, ${kept.length} already there. Nothing was overwritten.`);
  if (created.length > 0) {
    console.log("Next: fill in repos.yaml, list the existing docs in wiki/index.md, then commit.");
  }
  return 0;
}

async function runEvalFile(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { limit: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const path = positionals[0];
  if (!path) {
    console.error("eval needs a case file");
    return 2;
  }

  const cases = parseCases(await Bun.file(path).text());
  const db = openDb();
  try {
    const report = runEval(db, cases, values.limit ? Number(values.limit) : 5);
    console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
    return 0;
  } finally {
    db.close();
  }
}

function hostFromPath(path: string): Host {
  return path.includes("/.codex/") || /rollout-[^/]*\.jsonl$/.test(path) ? "codex" : "claude-code";
}

async function init(): Promise<number> {
  const config = await ensureConfig();
  const db = openDb();
  const fts5 = hasFts5(db);
  const settings = await loadConfig();

  console.log(
    [
      `home        ${homeDir()}`,
      `config      ${configPath()}${config.created ? "  (created)" : "  (kept)"}`,
      `database    ${dbPath()}  (schema v${schemaVersion(db)})`,
      `sqlite      ${sqliteVersion(db)}  FTS5: ${fts5 ? "yes" : "NO"}`,
      `bun         ${Bun.version}  ${process.execPath}`,
      `search      ${settings.embedding.provider}${settings.embedding.model ? ` (${settings.embedding.model})` : ""}`,
    ].join("\n"),
  );
  db.close();

  if (!fts5) {
    console.error("\nThis SQLite build has no FTS5, so keyword search cannot work. Use a SQLite build with FTS5 enabled.");
    return 1;
  }
  return 0;
}

async function archive(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, options: { host: { type: "string" } }, allowPositionals: true });
  const path = positionals[0];
  if (!path) {
    console.error("archive needs a transcript path");
    return 2;
  }

  const db = openDb();
  const result = await archiveFile(db, path, (values.host as Host) ?? hostFromPath(path));
  db.close();
  console.log(`${result.inserted} new turns, ${result.duplicates} already stored (${result.bytes} bytes read)`);
  return 0;
}

async function sweepAll(): Promise<number> {
  const db = openDb();
  const results = await sweep(db);
  const stored = (db.query("select count(*) as n from turn").get() as { n: number }).n;
  db.close();

  const { files, inserted, duplicates } = totals(results);
  console.log(`scanned ${results.length} transcripts, ${inserted} new turns from ${files} files, ${duplicates} already stored`);
  console.log(`turn table now holds ${stored} rows`);
  return 0;
}

function runSearch(args: string[]): number {
  const { values, positionals } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      kind: { type: "string", multiple: true },
      limit: { type: "string" },
      json: { type: "boolean" },
      here: { type: "boolean" }, // rank hits from the current repo first
    },
    allowPositionals: true,
  });

  const query = positionals.join(" ").trim();
  if (!query) {
    console.error("search needs a query");
    return 2;
  }

  const db = openDb();
  const hits = search(db, query, {
    limit: values.limit ? Number(values.limit) : undefined,
    repoId: values.repo ?? (values.here ? repoIdFromDir(process.cwd()) : null),
    kinds: values.kind as Kind[] | undefined,
  });
  db.close();

  if (values.json) {
    console.log(JSON.stringify(hits, null, 2));
  } else if (hits.length === 0) {
    console.log("no hits");
  } else {
    for (const hit of hits) {
      console.log(`${hit.kind.padEnd(6)} ${hit.ref}`);
      console.log(`       ${hit.title}`);
      console.log(`       ${hit.snippet.replace(/\s+/g, " ")}\n`);
    }
  }
  return 0;
}

function runGet(args: string[]): number {
  const [kind, ref] = args;
  if (!kind || !ref) {
    console.error("get needs a kind and a ref");
    return 2;
  }
  const db = openDb();
  const body = get(db, kind as Kind, ref);
  db.close();
  if (body === null) {
    console.error(`not found: ${kind} ${ref}`);
    return 1;
  }
  console.log(body);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "init":
    process.exit(await init());
  case "archive":
    process.exit(await archive(rest));
  case "sweep":
    process.exit(await sweepAll());
  case "search":
    process.exit(runSearch(rest));
  case "get":
    process.exit(runGet(rest));
  case "record":
    process.exit(await addRecordFromStdin());
  case "eval":
    process.exit(await runEvalFile(rest));
  case "init-repo":
    process.exit(await runInitRepo(rest));
  case "sync":
    process.exit(await runSync(rest));
  case undefined:
  case "-h":
  case "--help":
    console.log(USAGE);
    process.exit(0);
  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
}
