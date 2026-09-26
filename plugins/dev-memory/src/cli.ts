#!/usr/bin/env bun
// dev-memory CLI. Everything the hooks and skills do goes through here, so both tools behave alike.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { join } from "node:path";
import type { Host } from "./adapters/types";
import { archiveFile, sweep, totals } from "./core/archive";
import { configPath, dbPath, ensureConfig, homeDir, loadConfig } from "./core/config";
import { hasFts5, openDb, schemaVersion, sqliteVersion } from "./core/db";
import { formatReport, parseCases, runEval, suggestCases } from "./core/eval";
import { entityIndex, missingEntityPages } from "./core/entities";
import { exportRecords } from "./core/export";
import { formatLint, lintRepo } from "./core/lint";
import { configSuggestion, readReposYaml, resolveRepos, saveRepoPaths } from "./core/repos";
import { findStaleDocs, formatStale } from "./core/staleness";
import { indexExistingDocs } from "./core/index-docs";
import { initRepo } from "./core/init-repo";
import { publish } from "./core/publish";
import { formatSetup, runSetup } from "./core/setup";
import { sync as syncRepo } from "./core/sync";
import { branchName, changedPages, discardIngest, ensureWorktree } from "./core/worktree";
import { startReviewServer } from "./review/server";
import { repoIdFromDir } from "./core/repo-id";
import { type RecordInput, addRecord, contentHash, findByContentHash, gitAuthor } from "./core/record";
import { type Kind, get, search } from "./core/search";

const USAGE = `dev-memory

Usage:
  dev-memory setup [--repo <path>]    Set everything up and check it: start here after installing (--skip-sweep, --skip-sync)
  dev-memory init                     Create ~/.dev-memory, the local index and the config
  dev-memory archive <file> [--host]  Archive new lines of one transcript (host is inferred from the path)
  dev-memory sweep                    Archive every transcript of both tools
  dev-memory search <query>           Keyword search (--repo, --kind, --limit, --json)
  dev-memory get <kind> <ref>         Print the full text behind a search hit
  dev-memory record                   Save one record; reads its JSON from stdin
  dev-memory eval <file.yaml>         Measure retrieval against a case file (--limit, --json)
  dev-memory eval --suggest           Print candidate eval cases drawn from the memory
  dev-memory init-repo <dir>          Add the memory repo scaffolding to an existing repository
  dev-memory sync                     Import the memory repo's main branch into the local index (--repo, --skip-fetch)
  dev-memory ingest-start <slug>      Open a worktree for a new ingest and print where it is
  dev-memory export --branch <b>      Write local records from the repos in repos.yaml into the worktree as JSONL (--id)
  dev-memory ingest-discard --branch <b>  Throw an unsent ingest away and hand its records back to the next one
  dev-memory index-docs               Add the repo's existing hand-written docs to the README index
  dev-memory repos                    Where each code repo is on this machine (--product, --save)
  dev-memory entities                 Which tables, APIs and queues the records mention (--product, --json)
  dev-memory lint                     Check the docs: links, README index, duplicate titles, supersedes (--repo)
  dev-memory stale                    Compare each document's 程式碼位置 table with the local clones (--repo)
  dev-memory review --branch <b>      Serve the local review page for that ingest
  dev-memory publish --branch <b>     Push and open the PR. Only run this yourself; the agent must not.
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
    console.log(
      (await loadConfig()).memory.repo
        ? "stored locally until it is submitted to the memory repo"
        : `personal mode: stored only in ${dbPath()}`,
    );
    return 0;
  } finally {
    db.close();
  }
}

async function memoryRepo(explicit?: string): Promise<string | null> {
  const repo = explicit ?? (await loadConfig()).memory.repo;
  if (!repo) {
    console.error("No memory repo configured. Set memory.repo in ~/.dev-memory/config.toml, or pass --repo <path>.");
    return null;
  }
  return repo;
}

async function runIngestStart(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, options: { repo: { type: "string" }, branch: { type: "string" } }, allowPositionals: true });
  const repo = await memoryRepo(values.repo);
  if (!repo) return 2;

  const slug = positionals.join(" ").trim();
  if (!slug && !values.branch) {
    console.error("ingest-start needs a slug, for example: dev-memory ingest-start export-partial-failure");
    return 2;
  }

  const branch = values.branch ?? branchName(gitAuthor(repo), slug);
  const worktree = ensureWorktree(repo, branch);
  console.log(`branch    ${branch}`);
  console.log(`worktree  ${worktree.path}${worktree.created ? "  (created)" : "  (resumed)"}`);
  console.log("Write the pages in the worktree, then: dev-memory review --branch " + branch);
  return 0;
}

async function runExport(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { repo: { type: "string" }, branch: { type: "string" }, id: { type: "string", multiple: true } },
  });
  const repo = await memoryRepo(values.repo);
  if (!repo) return 2;
  if (!values.branch) {
    console.error("export needs --branch <branch>");
    return 2;
  }

  const worktree = ensureWorktree(repo, values.branch, { fetch: false });
  const db = openDb();
  try {
    const result = await exportRecords(db, worktree.path, { ids: values.id });
    console.log(`${result.written} records written, ${result.alreadyThere} already in the repo`);
    for (const file of result.files) console.log(`  ${file}`);
    if (result.outOfScope > 0) {
      console.log(`${result.outOfScope} local records stay on this machine: none of their repos is in repos.yaml (to send one anyway: --id <id>)`);
    }
    return 0;
  } finally {
    db.close();
  }
}

async function runIngestDiscard(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, branch: { type: "string" } } });
  const repo = await memoryRepo(values.repo);
  if (!repo) return 2;
  if (!values.branch) {
    console.error("ingest-discard needs --branch <branch>");
    return 2;
  }

  const config = await loadConfig();
  const db = openDb();
  try {
    const result = discardIngest(repo, values.branch, db, `origin/${config.memory.branch}`);
    if (result.status === "missing") {
      console.error(`找不到 ${values.branch}：沒有這個分支，也沒有它的工作區`);
      return 1;
    }
    if (result.status === "pushed") {
      console.error(`${values.branch} 已經 push 過，卡片在它的 PR 裡，本機什麼都沒動。\n要放棄的話，到 GitHub 把 PR 關掉。`);
      return 1;
    }
    console.log(`已捨棄 ${values.branch}：工作區跟本機分支都刪了，${result.returned} 張卡片退回本機，下次 ingest 會再帶上`);
    return 0;
  } finally {
    db.close();
  }
}

async function runRepos(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, product: { type: "string" }, save: { type: "boolean" } } });
  const memory = await memoryRepo(values.repo);
  if (!memory) return 2;

  const byProduct = await readReposYaml(memory);
  if (byProduct.size === 0) {
    console.error(`repos.yaml 裡沒有任何 repo：${join(memory, "repos.yaml")}`);
    return 1;
  }

  let missing = 0;
  for (const [product, entries] of byProduct) {
    if (values.product && values.product !== product) continue;
    console.log(`\n${product}`);
    const resolved = await resolveRepos(entries);
    for (const repo of resolved) {
      const note = repo.branchPerJob ? `  （一支批次一個分支，前綴 ${repo.jobBranchPrefix}）` : "";
      const refs = `  ref 依序試：${repo.refs.join(" → ")}`;
      if (repo.path) {
        console.log(`  ✓ ${repo.id}`);
        console.log(`    ${repo.path}  [${repo.via === "config" ? "設定檔" : "自動找到"}]${note}`);
        console.log(`  ${refs}`);
      } else {
        missing++;
        console.log(`  ✗ ${repo.id}  找不到本機 clone${note}`);
      }
    }
    if (values.save) {
      const saved = await saveRepoPaths(resolved);
      if (saved > 0) console.log(`\n  已寫進 ${configPath()}（${saved} 個），之後不再重新探測`);
    }
    const suggestion = configSuggestion(resolved);
    if (suggestion) {
      console.log(`\n  把下面幾行加進 ${configPath()}：\n`);
      for (const line of suggestion.split("\n")) console.log(`    ${line}`);
    }
  }
  return missing > 0 ? 1 : 0;
}

async function runEntities(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { product: { type: "string" }, json: { type: "boolean" } } });
  const db = openDb();
  try {
    const entities = entityIndex(db, { product: values.product });
    const missing = new Set(missingEntityPages(db, entities).map((entity) => `${entity.kind}:${entity.name}`));

    if (values.json) {
      console.log(JSON.stringify(entities.map((entity) => ({ ...entity, hasPage: !missing.has(`${entity.kind}:${entity.name}`) })), null, 2));
      return 0;
    }
    if (entities.length === 0) {
      console.log("紀錄裡還沒有提到任何 entity。");
      return 0;
    }
    for (const entity of entities) {
      const page = missing.has(`${entity.kind}:${entity.name}`) ? "  ← 還沒有文件提到" : "";
      console.log(`${entity.kind.padEnd(9)} ${entity.name}${page}`);
      if (entity.writers.length > 0) console.log(`          寫入：${entity.writers.join(", ")}`);
      if (entity.readers.length > 0) console.log(`          讀取：${entity.readers.join(", ")}`);
      const unknown = entity.uses.filter((use) => use.access === "unknown").map((use) => use.repo);
      if (unknown.length > 0) console.log(`          未標明讀寫：${[...new Set(unknown)].join(", ")}`);
      console.log(`          來自 ${entity.recordIds.length} 筆紀錄`);
    }
    return 0;
  } finally {
    db.close();
  }
}

async function runLint(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" } } });
  const repo = await memoryRepo(values.repo);
  if (!repo) return 2;

  const db = openDb();
  try {
    const report = await lintRepo(db, repo);
    console.log(formatLint(report));
    return report.findings.some((finding) => finding.level === "error") ? 1 : 0;
  } finally {
    db.close();
  }
}

async function runStale(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" } } });
  const repo = await memoryRepo(values.repo);
  if (!repo) return 2;

  console.log(formatStale(await findStaleDocs(repo)));
  return 0;
}

async function runIndexDocs(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, options: { repo: { type: "string" } }, allowPositionals: true });
  const repo = positionals[0] ?? (await memoryRepo(values.repo));
  if (!repo) return 2;

  const result = await indexExistingDocs(repo);
  console.log(
    `${result.docs.length} 份文件補進 ${result.indexPath}，${result.alreadyIndexed} 份原本就索引到了${result.changed ? "" : "（沒有變更）"}`,
  );
  for (const doc of result.docs) console.log(`  ${doc}`);
  return 0;
}

async function runReview(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, branch: { type: "string" }, open: { type: "boolean", default: true } } });
  const repo = await memoryRepo(values.repo);
  if (!repo) return 2;
  if (!values.branch) {
    console.error("review needs --branch <branch>");
    return 2;
  }

  const worktree = ensureWorktree(repo, values.branch, { fetch: false });
  const config = await loadConfig();
  let finished: () => void;
  const untilDone = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const server = startReviewServer({
    worktree: worktree.path,
    branch: values.branch,
    base: `origin/${config.memory.branch}`,
    // The button in the page is the only way to publish; the agent is told never to call it.
    onPublish: async (path, branch) => publish(path, branch, { base: config.memory.branch }),
    onFinished: () => finished(),
  });

  console.log(`review page: ${server.url}`);
  console.log(`pages in this ingest: ${changedPages(worktree.path, `origin/${config.memory.branch}`).length}`);
  if (values.open) spawnSync(process.platform === "darwin" ? "open" : "xdg-open", [server.url]);
  console.log("Press Ctrl-C to stop, or send the PR and this closes by itself.");
  await untilDone; // the publish button ends the review
  server.stop();
  console.log("PR 已送出，審核頁關閉。合併後記得跑 `dev-memory sync`。");
  return 0;
}

async function runPublish(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, branch: { type: "string" }, "no-pr": { type: "boolean" } } });
  const repo = await memoryRepo(values.repo);
  if (!repo) return 2;
  if (!values.branch) {
    console.error("publish needs --branch <branch>");
    return 2;
  }

  const config = await loadConfig();
  const worktree = ensureWorktree(repo, values.branch, { fetch: false });
  try {
    const result = publish(worktree.path, values.branch, { base: config.memory.branch, openPr: !values["no-pr"] });
    console.log(result.message);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runSync(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, "skip-fetch": { type: "boolean" } } });
  const config = await loadConfig();
  const repo = values.repo ?? config.memory.repo;
  if (!repo) {
    console.error("No memory repo configured. Set memory.repo in ~/.dev-memory/config.toml, or pass --repo <path>.");
    return 2;
  }

  const db = openDb();
  try {
    const result = syncRepo(db, repo, { branch: config.memory.branch, fetch: !values["skip-fetch"] });
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
    console.log("Next: fill in repos.yaml, run dev-memory index-docs to list the existing docs in README.md, then commit.");
  }
  return 0;
}

async function runEvalFile(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { limit: { type: "string" }, json: { type: "boolean" }, suggest: { type: "boolean" } },
    allowPositionals: true,
  });

  if (values.suggest) {
    const db = openDb();
    try {
      console.log(suggestCases(db, values.limit ? Number(values.limit) : 30));
      return 0;
    } finally {
      db.close();
    }
  }

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

async function setup(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      branch: { type: "string" },
      "skip-sweep": { type: "boolean" },
      "skip-sync": { type: "boolean" },
    },
  });

  const result = await runSetup({
    repo: values.repo,
    branch: values.branch,
    sweep: !values["skip-sweep"],
    sync: !values["skip-sync"],
  });
  console.log(formatSetup(result));
  return result.checks.every((check) => check.ok) ? 0 : 1;
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

  const { exclude } = (await loadConfig()).capture;
  const db = openDb();
  const result = await archiveFile(db, path, (values.host as Host) ?? hostFromPath(path), exclude);
  db.close();
  console.log(`${result.inserted} new turns, ${result.duplicates} already stored (${result.bytes} bytes read)`);
  return 0;
}

async function sweepAll(): Promise<number> {
  const { exclude } = (await loadConfig()).capture;
  const db = openDb();
  const results = await sweep(db, { exclude });
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
  case "setup":
    process.exit(await setup(rest));
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
  case "ingest-start":
    process.exit(await runIngestStart(rest));
  case "export":
    process.exit(await runExport(rest));
  case "ingest-discard":
    process.exit(await runIngestDiscard(rest));
  case "index-docs":
    process.exit(await runIndexDocs(rest));
  case "repos":
    process.exit(await runRepos(rest));
  case "entities":
    process.exit(await runEntities(rest));
  case "lint":
    process.exit(await runLint(rest));
  case "stale":
    process.exit(await runStale(rest));
  case "review":
    process.exit(await runReview(rest));
  case "publish":
    process.exit(await runPublish(rest));
  case undefined:
  case "-h":
  case "--help":
    console.log(USAGE);
    process.exit(0);
  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
}
