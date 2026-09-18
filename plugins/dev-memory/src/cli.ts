#!/usr/bin/env bun
// dev-memory CLI. More commands arrive with later phases; today only `init`.
import { configPath, dbPath, ensureConfig, homeDir, loadConfig } from "./core/config";
import { hasFts5, openDb, schemaVersion, sqliteVersion } from "./core/db";

const USAGE = `dev-memory

Usage:
  dev-memory init    Create ~/.dev-memory, the local index and the config, then check the environment
`;

async function init(): Promise<number> {
  const config = await ensureConfig();
  const db = openDb();
  const fts5 = hasFts5(db);
  const settings = await loadConfig();

  const lines = [
    `home        ${homeDir()}`,
    `config      ${configPath()}${config.created ? "  (created)" : "  (kept)"}`,
    `database    ${dbPath()}  (schema v${schemaVersion(db)})`,
    `sqlite      ${sqliteVersion(db)}  FTS5: ${fts5 ? "yes" : "NO"}`,
    `bun         ${Bun.version}  ${process.execPath}`,
    `search      ${settings.embedding.provider}${settings.embedding.model ? ` (${settings.embedding.model})` : ""}`,
  ];
  console.log(lines.join("\n"));
  db.close();

  if (!fts5) {
    console.error("\nThis SQLite build has no FTS5, so keyword search cannot work. Rebuild Bun's SQLite or use a build with FTS5 enabled.");
    return 1;
  }
  return 0;
}

const command = process.argv[2];
switch (command) {
  case "init":
    process.exit(await init());
  case undefined:
  case "-h":
  case "--help":
    console.log(USAGE);
    process.exit(0);
  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
}
