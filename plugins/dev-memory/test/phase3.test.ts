import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db";
import { entityIndex, entitySlug, missingEntityPages } from "../src/core/entities";
import { formatLint, lintRepo } from "../src/core/lint";
import { parseCodeRefs } from "../src/core/code-refs";
import { findStaleDocs, formatStale } from "../src/core/staleness";

const dirs: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-phase3-"));
  dirs.push(dir);
  return { dir, db: openDb(join(dir, "memory.db")) };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function addRecordRow(db: ReturnType<typeof openDb>, overrides: Record<string, unknown> = {}) {
  const row = {
    id: `01JBP3${Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(20, "0")}`,
    author: "bill.lin",
    host: "claude-code",
    product: "billing",
    repos: JSON.stringify(["104corp/billing-batch"]),
    entities: JSON.stringify([{ kind: "table", name: "export_job", access: "write" }]),
    title: "匯出報表改成單筆失敗不中斷",
    body: "原因：…\n決定：…",
    created_at: "2026-09-18T01:00:00.000Z",
    ...overrides,
  };
  db.run(
    `insert into record (id, author, host, product, repos, branch, type, title, body, entities, files, commits, supersedes, content_hash, status, created_at)
     values (?, ?, ?, ?, ?, null, 'decision', ?, ?, ?, '[]', '[]', null, 'sha256:x', 'local', ?)`,
    [row.id, row.author, row.host, row.product, row.repos, row.title, row.body, row.entities, row.created_at],
  );
  return row;
}

describe("entities", () => {
  test("collects who writes and who reads, across repos", () => {
    const { db } = workspace();
    addRecordRow(db);
    addRecordRow(db, { repos: JSON.stringify(["104corp/billing-api"]), entities: JSON.stringify([{ kind: "table", name: "export_job", access: "read" }]) });
    addRecordRow(db, { repos: JSON.stringify(["104corp/billing-frontend"]), entities: JSON.stringify([{ kind: "api", name: "GET /exports" }]) });

    const entities = entityIndex(db);
    const table = entities.find((entity) => entity.name === "export_job")!;
    expect(table.writers).toEqual(["104corp/billing-batch"]);
    expect(table.readers).toEqual(["104corp/billing-api"]);
    expect(table.recordIds).toHaveLength(2);

    const api = entities.find((entity) => entity.kind === "api")!;
    expect(api.uses[0]).toMatchObject({ repo: "104corp/billing-frontend", access: "unknown" });
    db.close();
  });

  test("filters by product and reports which entities no document mentions", () => {
    const { db } = workspace();
    addRecordRow(db);
    addRecordRow(db, { product: "crm", entities: JSON.stringify([{ kind: "queue", name: "crm-sync" }]) });
    // A document covers a table by talking about it; it has no frontmatter and needs no page of its own.
    db.run("insert into page (path, title, body) values ('spec/batch/export.md', '匯出批次', '結果寫進 EXPORT_JOB，失敗的列另外記')");
    db.run("insert into page (path, title, body) values ('spec/crm.md', 'CRM', '同步用的 queue 還沒寫')");

    expect(entityIndex(db, { product: "crm" }).map((entity) => entity.name)).toEqual(["crm-sync"]);
    expect(missingEntityPages(db, entityIndex(db)).map((entity) => entity.name)).toEqual(["crm-sync"]);
    expect(entitySlug("GET /exports")).toBe("get-exports");
    db.close();
  });
});

describe("lint", () => {
  const page = (front: Record<string, unknown>, body = "內容\n") =>
    `---\n${Object.entries(front)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? JSON.stringify(value) : value}`)
      .join("\n")}\n---\n${body}`;

  async function repo(files: Record<string, string>) {
    const { dir, db } = workspace();
    const repoDir = join(dir, "repo");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(repoDir, path, ".."), { recursive: true });
      await Bun.write(join(repoDir, path), content);
    }
    return { repo: repoDir, db };
  }

  test("a code-location table is checked only where there is one", async () => {
    const { repo: dir, db } = await repo({
      "README.md": "# 目錄\n1. [a](./spec/a.md)\n2. [b](./spec/b.md)\n",
      "repos.yaml": "products:\n  billing:\n    repos:\n      - id: 104corp/billing-api\n        refs: [dev]\n",
      "spec/a.md":
        "# a\n\n## 程式碼位置\n\n| 內容 | repo | 分支 | 路徑 |\n|---|---|---|---|\n| a | `billing-api` | `dev` | `src/A.java` |\n| b | `unknown-repo` | `dev` | `src/B.java` |\n",
      "spec/b.md": "# b\n\n人工寫的，沒有程式碼位置表。\n",
    });
    const report = await lintRepo(db, dir);
    expect(report.findings.map((finding) => [finding.path, finding.message])).toEqual([
      ["spec/a.md", "程式碼位置表的 repo「unknown-repo」不在 repos.yaml 裡"],
    ]);
    db.close();
  });

  test("a healthy repo is clean", async () => {
    const { repo: dir, db } = await repo({
      "README.md": "# 目錄\n1. [匯出報表](./spec/export.md)\n",
      "spec/export.md": "# 匯出報表\n\n完整資料流。來源紀錄 01JBSOURCE0000000000000001。\n",
      "records/billing/2026-09/bill.lin.jsonl":
        JSON.stringify({ id: "01JBSOURCE0000000000000001", author: "a", host: "claude-code", type: "decision", title: "t", body: "b", content_hash: "sha256:x", created_at: "2026-09-18T00:00:00.000Z" }) + "\n",
    });

    const report = await lintRepo(db, dir);
    expect(report).toMatchObject({ docs: 1, records: 1 });
    expect(report.findings).toEqual([]);
    expect(formatLint(report)).toContain("0 errors, 0 warnings");
    db.close();
  });

  test("catches broken links and documents README does not index", async () => {
    const { repo: dir, db } = await repo({
      "README.md": "# 目錄\n1. [匯出報表](./spec/export.md)\n",
      "spec/export.md": "# 匯出報表\n\n見 [排程](./gone.md)。\n",
      "spec/orphan.md": "# 沒人連到我\n\n內容。\n",
    });

    const report = await lintRepo(db, dir);
    const messages = report.findings.map((finding) => finding.message);
    expect(messages.some((message) => message.includes("連結指向不存在的檔案：./gone.md"))).toBe(true);
    expect(messages.some((message) => message.includes("README.md 沒有連到這一頁"))).toBe(true);
    db.close();
  });

  test("a document with leftover frontmatter or no title is reported", async () => {
    const { repo: dir, db } = await repo({
      "README.md": "# 目錄\n1. [舊頁](./spec/old.md)\n",
      "spec/old.md": "---\ntype: decision\n---\n沒有標題的內容。\n",
    });

    const report = await lintRepo(db, dir);
    const messages = report.findings.map((finding) => finding.message);
    expect(messages.some((message) => message.includes("frontmatter"))).toBe(true);
    expect(messages.some((message) => message.includes("沒有第一層標題"))).toBe(true);
    db.close();
  });

  test("two documents under the same heading are flagged", async () => {
    const { repo: dir, db } = await repo({
      "README.md": "# 目錄\n1. [甲](./spec/a.md)\n2. [乙](./spec/b.md)\n",
      "spec/a.md": "# 測評點數拋轉 ERP\n\n第一份。\n",
      "spec/b.md": "# 測評點數拋轉 ERP\n\n又一份。\n",
    });

    const report = await lintRepo(db, dir);
    const dupes = report.findings.filter((finding) => finding.message.includes("標題"));
    expect(dupes).toHaveLength(2);
    expect(dupes[0].level).toBe("warning");
    db.close();
  });

  test("supersedes must name a record that exists somewhere", async () => {
    const line = (id: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        id,
        author: "a",
        host: "claude-code",
        type: "decision",
        title: "t",
        body: "b",
        content_hash: "sha256:x",
        created_at: "2026-09-21T00:00:00.000Z",
        ...extra,
      });

    const { repo: dir, db } = await repo({
      "README.md": "# 目錄\n",
      "records/billing/2026-09/bill.lin.jsonl":
        `${line("01JBSOURCE0000000000000001")}\n` +
        `${line("01JBSOURCE0000000000000002", { supersedes: "01JBSOURCE0000000000000001" })}\n` +
        `${line("01JBSOURCE0000000000000003", { supersedes: "01JBSOURCE0000000000000009" })}\n`,
    });

    const report = await lintRepo(db, dir);
    const broken = report.findings.filter((finding) => finding.message.includes("supersedes"));
    expect(broken).toHaveLength(1); // only the one pointing at 0009
    expect(broken[0].level).toBe("error");
    expect(broken[0].message).toContain("01JBSOURCE0000000000000009");
    db.close();
  });

  test("a record id nobody has is a warning, not an error", async () => {
    const { repo: dir, db } = await repo({
      "README.md": "# 目錄\n1. [匯出報表](./spec/export.md)\n",
      "spec/export.md": "# 匯出報表\n\n來源 01JBZZZZZZ0000000000000001。\n",
    });

    const report = await lintRepo(db, dir);
    const missing = report.findings.filter((finding) => finding.message.includes("不在這個 repo 也不在本機索引"));
    expect(missing).toHaveLength(1);
    expect(missing[0].level).toBe("warning");
    db.close();
  });
});

describe("staleness", () => {
  function gitAt(cwd: string, date: string, ...args: string[]) {
    const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }

  const TABLE = `# 匯出批次

內容。

## 相關文件與程式碼位置

| 內容 | repo | 分支 | 路徑 |
|---|---|---|---|
| 主程式 | \`billing-api\` | \`dev\` | \`src/Runner.java\` |
| 沒動過 | 同上 | 同上 | \`src/Quiet.java\` |
| 已刪掉 | 同上 | 同上 | \`src/Gone.java\` |
| 沒這個分支 | 同上 | \`release\` | \`src/Runner.java\` |
| 沒 clone | \`billing-batch\` | \`dev\` | \`src/Job.java\` |
`;

  /** A doc repo written on 09-01, and a code repo whose dev branch moved on 09-10. */
  async function fixture() {
    const { dir } = workspace();
    const code = join(dir, "billing-api");
    mkdirSync(join(code, "src"), { recursive: true });
    gitAt(code, "2026-08-01T00:00:00Z", "init", "-q", "-b", "dev");
    for (const name of ["Runner", "Quiet", "Gone"]) await Bun.write(join(code, "src", `${name}.java`), `class ${name} {}\n`);
    gitAt(code, "2026-08-01T00:00:00Z", "add", ".");
    gitAt(code, "2026-08-01T00:00:00Z", "commit", "-q", "-m", "init");

    const docs = join(dir, "docs");
    mkdirSync(join(docs, "spec"), { recursive: true });
    gitAt(docs, "2026-09-01T00:00:00Z", "init", "-q", "-b", "main");
    await Bun.write(join(docs, "spec", "export.md"), TABLE);
    await Bun.write(join(docs, "spec", "human.md"), "# 人工文件\n\n沒有程式碼位置表。\n");
    gitAt(docs, "2026-09-01T00:00:00Z", "add", ".");
    gitAt(docs, "2026-09-01T00:00:00Z", "commit", "-q", "-m", "docs");

    await Bun.write(join(code, "src", "Runner.java"), "class Runner { void run() {} }\n");
    rmSync(join(code, "src", "Gone.java"));
    gitAt(code, "2026-09-10T00:00:00Z", "add", "-A");
    gitAt(code, "2026-09-10T00:00:00Z", "commit", "-q", "-m", "fix: runner");

    return { docs, clones: new Map<string, string | null>([["billing-api", code], ["billing-batch", null]]) };
  }

  test("a document is stale when its code changed or vanished after the document's last commit", async () => {
    const { docs, clones } = await fixture();
    const report = await findStaleDocs(docs, { clones });

    expect(report.findings.map((finding) => [finding.doc, finding.path, finding.missing])).toEqual([
      ["spec/export.md", "src/Runner.java", false],
      ["spec/export.md", "src/Gone.java", true],
    ]);
    expect(report.findings[0].commits[0]).toContain("fix: runner");
    expect(report.checked).toBe(3); // Quiet.java was looked at and is fine
    expect(report.withoutTable).toBe(1);
    expect(report.unreachable).toEqual(["billing-api：沒有 release 分支（先 git fetch）", "billing-batch：這台機器上找不到 clone"]);

    const text = formatStale(report);
    expect(text).toContain("1 份文件可能過時");
    expect(text).toContain("1 份文件沒有程式碼位置表");
  });

  test("the code-location table: ditto marks, braces, and what is malformed", () => {
    const table = parseCodeRefs(
      "# x\n\n## 程式碼位置\n\n| 內容 | repo | 分支 | 路徑 |\n|---|---|---|---|\n| a | `api` | `dev` | `deploy/env-{dev,prod}.sh` |\n| b | 同上 | 同上 | `src/` |\n",
    );
    expect(table).toEqual({
      refs: [
        { repo: "api", branch: "dev", path: "deploy/env-dev.sh" },
        { repo: "api", branch: "dev", path: "deploy/env-prod.sh" },
        { repo: "api", branch: "dev", path: "src/" },
      ],
      problems: [],
    });

    expect(parseCodeRefs("# x\n\n## 設計考量\n\n內容\n")).toBeNull();
    expect(parseCodeRefs("# x\n\n## 程式碼位置\n\n| 內容 | repo | 路徑 |\n|---|---|---|\n| a | api | src/ |\n")!.problems).toEqual([
      "程式碼位置表缺「分支」欄",
    ]);
    expect(parseCodeRefs("# x\n\n## 程式碼位置\n\n| 內容 | repo | 分支 | 路徑 |\n|---|---|---|---|\n| a | 同上 | 同上 | src/ |\n")!.problems).toEqual([
      "程式碼位置表第 1 列缺 repo、分支或路徑",
    ]);
  });

  test("nothing to check says so", async () => {
    const { dir } = workspace();
    mkdirSync(join(dir, "spec"), { recursive: true });
    await Bun.write(join(dir, "spec", "a.md"), "# a\n");
    const report = await findStaleDocs(dir, { clones: new Map() });
    expect(report.checked).toBe(0);
    expect(formatStale(report)).toContain("沒有任何文件有程式碼位置表");
  });
});

test("an entity slug keeps the identifier readable", () => {
  expect(entitySlug("export_job")).toBe("export_job"); // a table name is an identifier
  expect(entitySlug("GET /exports/{id}")).toBe("get-exports-id");
  expect(entitySlug("SAP")).toBe("sap");
});
