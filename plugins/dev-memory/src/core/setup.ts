// One command a teammate runs after installing the plugin.
//
// Everything it checks is something that has actually blocked someone: bun missing from PATH
// (hooks and the MCP server both start with it), a SQLite without FTS5, gh not logged in, and
// the memory repo path that used to be a hand-edited line in config.toml.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sweep, totals } from "./archive";
import { configPath, ensureConfig, homeDir, loadConfig } from "./config";
import { hasFts5, openDb, schemaVersion, sqliteVersion } from "./db";
import { sync } from "./sync";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface SetupResult {
  checks: Check[];
  repo: string | null;
  swept: number;
  synced: { records: number; pages: number } | null;
}

export interface SetupOptions {
  repo?: string;
  branch?: string;
  sweep?: boolean;
  sync?: boolean;
}

function run(command: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const result = spawnSync(command, args, { encoding: "utf8", cwd });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

/**
 * Writes the memory repo into config.toml, keeping the comments around it. Bun can parse TOML
 * but not serialize it, so the file is edited line by line rather than round-tripped.
 */
export async function setMemoryRepo(repo: string, branch?: string): Promise<void> {
  const path = configPath();
  const text = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";

  if (!text.includes("[memory]")) {
    await Bun.write(path, `${text.trimEnd()}\n\n[memory]\nrepo = "${repo}"\nbranch = "${branch ?? "main"}"\n`);
    return;
  }

  const lines = text.split("\n");
  let inMemory = false;
  let wroteRepo = false;
  let wroteBranch = branch === undefined;

  const next = lines.map((line) => {
    if (line.trim().startsWith("[")) inMemory = line.trim() === "[memory]";
    if (!inMemory) return line;

    if (/^\s*repo\s*=/.test(line)) {
      wroteRepo = true;
      const comment = line.includes("#") ? `  ${line.slice(line.indexOf("#"))}` : "";
      return `repo = "${repo}"${comment}`;
    }
    if (branch !== undefined && /^\s*branch\s*=/.test(line)) {
      wroteBranch = true;
      return `branch = "${branch}"`;
    }
    return line;
  });

  if (!wroteRepo) next.push(`repo = "${repo}"`);
  if (!wroteBranch) next.push(`branch = "${branch}"`);
  await Bun.write(path, next.join("\n"));
}

function checkMemoryRepo(repo: string | null): Check[] {
  if (!repo) {
    return [
      {
        name: "memory repo",
        ok: false,
        detail: "還沒設定",
        fix: "先 clone 團隊的記憶 repo，再跑 dev-memory setup --repo <clone 的路徑>",
      },
    ];
  }

  const checks: Check[] = [];
  const inRepo = run("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"]);
  if (!inRepo.ok) {
    checks.push({ name: "memory repo", ok: false, detail: `${repo} 不是 git repo`, fix: "確認路徑，或先 git clone" });
    return checks;
  }

  const origin = run("git", ["-C", repo, "remote", "get-url", "origin"]);
  checks.push({
    name: "memory repo",
    ok: origin.ok,
    detail: origin.ok ? `${repo}\n            ${origin.out}` : `${repo}（沒有 origin remote）`,
    fix: origin.ok ? undefined : "git remote add origin <團隊 repo 的網址>",
  });

  const scaffolded = ["schema.md", "wiki", "records"].every((entry) => existsSync(join(repo, entry)));
  checks.push({
    name: "repo 結構",
    ok: scaffolded,
    detail: scaffolded ? "schema.md、wiki/、records/ 都在" : "還沒有 schema.md / wiki/ / records/",
    fix: scaffolded ? undefined : `dev-memory init-repo ${repo}`,
  });

  return checks;
}

export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const checks: Check[] = [];

  // 1. environment
  const bun = Bun.which("bun");
  checks.push({
    name: "bun",
    ok: bun !== null,
    detail: bun ? `${Bun.version}  ${bun}` : "PATH 裡找不到 bun",
    fix: bun ? undefined : "brew install bun，然後確認新開的終端機 which bun 找得到",
  });

  const git = Bun.which("git");
  checks.push({ name: "git", ok: git !== null, detail: git ?? "找不到 git", fix: git ? undefined : "xcode-select --install" });

  const gh = Bun.which("gh");
  const ghAuth = gh ? run("gh", ["auth", "status"]) : { ok: false, out: "" };
  checks.push({
    name: "gh",
    ok: gh !== null && ghAuth.ok,
    detail: !gh ? "找不到 gh" : ghAuth.ok ? "已登入" : "裝好了但還沒登入",
    fix: !gh ? "brew install gh && gh auth login" : ghAuth.ok ? undefined : "gh auth login",
  });

  // 2. local index
  await ensureConfig();
  const db = openDb();
  const fts5 = hasFts5(db);
  checks.push({
    name: "本機索引",
    ok: fts5,
    detail: `${homeDir()}  (schema v${schemaVersion(db)}, SQLite ${sqliteVersion(db)})`,
    fix: fts5 ? undefined : "這個 SQLite 沒有 FTS5，中文搜尋無法運作",
  });

  // 3. memory repo
  if (options.repo) await setMemoryRepo(options.repo, options.branch);
  const config = await loadConfig();
  const repo = config.memory.repo;
  checks.push(...checkMemoryRepo(repo));

  // 4. fill the index
  let swept = 0;
  if (options.sweep !== false) {
    swept = totals(await sweep(db)).inserted;
  }

  let synced: SetupResult["synced"] = null;
  if (repo && options.sync !== false && checks.every((check) => check.name !== "memory repo" || check.ok)) {
    try {
      const result = sync(db, repo, { branch: config.memory.branch });
      synced = { records: result.records.imported, pages: result.pages.imported };
    } catch {
      // offline, or no access yet: setup should still finish and say what is left to do
      checks.push({ name: "sync", ok: false, detail: "這次沒同步成功（可能離線或還沒有權限）", fix: "之後再跑 dev-memory sync" });
    }
  }

  db.close();
  return { checks, repo, swept, synced };
}

export function formatSetup(result: SetupResult): string {
  const lines = result.checks.map((check) => {
    const head = `${check.ok ? "✓" : "✗"} ${check.name.padEnd(10)} ${check.detail}`;
    return check.fix ? `${head}\n            → ${check.fix}` : head;
  });

  lines.push("");
  lines.push(`索引：${result.swept > 0 ? `新增 ${result.swept} 筆對話` : "沒有新的對話要收"}`);
  if (result.synced) lines.push(`同步：匯入 ${result.synced.records} 筆紀錄、${result.synced.pages} 個頁面`);

  const blocking = result.checks.filter((check) => !check.ok);
  lines.push("");
  lines.push(
    blocking.length === 0
      ? "都好了。做完一個決定時跟 AI 說「把這個決定存起來」就會開始記。"
      : `還有 ${blocking.length} 件事要處理，照上面的 → 做完再跑一次 dev-memory setup。`,
  );
  return lines.join("\n");
}
