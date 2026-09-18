#!/usr/bin/env bun
// dev-memory CLI. Everything the hooks and skills do goes through here, so both tools behave alike.
import { parseArgs } from "node:util";
import type { Host } from "./adapters/types";
import { archiveFile, sweep, totals } from "./core/archive";
import { configPath, dbPath, ensureConfig, homeDir, loadConfig } from "./core/config";
import { hasFts5, openDb, schemaVersion, sqliteVersion } from "./core/db";
import { repoIdFromDir } from "./core/repo-id";
import { type Kind, get, search } from "./core/search";

const USAGE = `dev-memory

Usage:
  dev-memory init                     Create ~/.dev-memory, the local index and the config
  dev-memory archive <file> [--host]  Archive new lines of one transcript (host is inferred from the path)
  dev-memory sweep                    Archive every transcript of both tools
  dev-memory search <query>           Keyword search (--repo, --kind, --limit, --json)
  dev-memory get <kind> <ref>         Print the full text behind a search hit
`;

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
  case undefined:
  case "-h":
  case "--help":
    console.log(USAGE);
    process.exit(0);
  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
}
