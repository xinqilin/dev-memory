import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db";
import { entityIndex, entitySlug, missingEntityPages } from "../src/core/entities";
import { formatLint, lintRepo } from "../src/core/lint";
import { findStalePages, formatStale } from "../src/core/staleness";

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

  test("filters by product and reports which entities still have no page", () => {
    const { db } = workspace();
    addRecordRow(db);
    addRecordRow(db, { product: "crm", entities: JSON.stringify([{ kind: "queue", name: "crm-sync" }]) });
    db.run("insert into page (path, type, title, body) values ('wiki/billing/entities/tables/export_job.md', 'entity', 'export_job', 'x')");

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

  test("a healthy repo is clean", async () => {
    const { repo: dir, db } = await repo({
      "wiki/index.md": "# 目錄\n- [決策](billing/decisions/a.md)\n",
      "wiki/billing/decisions/a.md": page({ type: "decision", title: "匯出報表改成單筆失敗不中斷", status: "active", sources: ["01JBSOURCE0000000000000001"], updated: "2026-09-18" }),
      "records/billing/2026-09/bill.lin.jsonl": JSON.stringify({ id: "01JBSOURCE0000000000000001", title: "匯出報表改成單筆失敗不中斷" }) + "\n",
    });

    const report = await lintRepo(db, dir);
    expect(report).toMatchObject({ pages: 1, records: 1 });
    expect(report.findings).toEqual([]);
    expect(formatLint(report)).toContain("0 errors, 0 warnings");
    db.close();
  });

  test("catches broken links, orphans, bad superseding and missing sources", async () => {
    const { repo: dir, db } = await repo({
      "wiki/index.md": "# 目錄\n- [a](billing/decisions/a.md)\n",
      "wiki/billing/decisions/a.md": page(
        { type: "decision", title: "a", status: "active", sources: ["01JBMISSING000000000000001"], updated: "2026-09-18" },
        "看 [[nowhere]] 還有 [壞掉的相對連結](./gone.md)\n",
      ),
      "wiki/billing/decisions/orphan.md": page({ type: "decision", title: "orphan", status: "superseded", superseded_by: "nothing", updated: "2026-09-18" }),
    });

    const messages = (await lintRepo(db, dir)).findings.map((finding) => finding.message);
    expect(messages).toContain("連到不存在的頁面 [[nowhere]]");
    expect(messages.some((message) => message.includes("連到不存在的檔案 ./gone.md"))).toBe(true);
    expect(messages.some((message) => message.includes("sources[] 指向不存在的紀錄"))).toBe(true);
    expect(messages.some((message) => message.includes("沒有被 wiki/index.md 連到"))).toBe(true);
    expect(messages.some((message) => message.includes("superseded_by 指向不存在的頁面"))).toBe(true);
    db.close();
  });

  test("warns when a page's sources share no wording with it", async () => {
    const { repo: dir, db } = await repo({
      "wiki/index.md": "# 目錄\n- [a](billing/decisions/a.md)\n",
      "wiki/billing/decisions/a.md": page({ type: "decision", title: "排程改成每天兩點跑", status: "active", sources: ["01JBSOURCE0000000000000002"], updated: "2026-09-18" }),
    });
    db.run(
      `insert into record (id, author, host, type, title, body, content_hash, created_at, status) values (?, 'x', 'claude-code', 'decision', ?, ?, 'sha256:x', '2026-09-18', 'merged')`,
      ["01JBSOURCE0000000000000002", "完全不相干的標題", "講的是別件事"],
    );

    const messages = (await lintRepo(db, dir)).findings.map((finding) => finding.message);
    expect(messages.some((message) => message.includes("可能引錯來源"))).toBe(true);
    db.close();
  });

  test("two active pages with the same title are flagged as a possible contradiction", async () => {
    const { repo: dir, db } = await repo({
      "wiki/index.md": "# 目錄\n- [a](billing/decisions/a.md)\n- [b](billing/decisions/b.md)\n",
      "wiki/billing/decisions/a.md": page({ type: "decision", title: "重試策略", status: "active", sources: ["x"], updated: "2026-09-18" }),
      "wiki/billing/decisions/b.md": page({ type: "decision", title: "重試策略", status: "active", sources: ["x"], updated: "2026-09-18" }),
      "records/billing/2026-09/bill.lin.jsonl": JSON.stringify({ id: "x" }) + "\n",
    });

    const messages = (await lintRepo(db, dir)).findings.map((finding) => finding.message);
    expect(messages.filter((message) => message.includes("跟其他頁同名而且都還是 active"))).toHaveLength(2);
    db.close();
  });
});

describe("staleness", () => {
  async function repoWith(front: string) {
    const { dir } = workspace();
    const repoDir = join(dir, "repo");
    mkdirSync(join(repoDir, "wiki", "billing", "decisions"), { recursive: true });
    await Bun.write(join(repoDir, "wiki", "billing", "decisions", "a.md"), `---\n${front}\n---\n內容\n`);
    return repoDir;
  }

  test("reports a page whose code changed after it was written", async () => {
    const dir = await repoWith(
      "type: decision\ntitle: a\nstatus: active\nupdated: 2026-09-01\ncode_refs:\n  - repo: 104corp/billing-batch\n    paths: [src/Runner.java]",
    );

    const report = await findStalePages(dir, {
      commitsSince: (repo, path, since) => {
        expect(repo).toBe("104corp/billing-batch");
        expect(path).toBe("src/Runner.java");
        expect(since).toBe("2026-09-01T00:00:00Z");
        return { count: 3, last: "2026-09-17T10:00:00Z" };
      },
    });

    expect(report.checked).toBe(1);
    expect(report.findings[0]).toMatchObject({ repo: "104corp/billing-batch", commits: 3 });
    expect(formatStale(report)).toContain("1 個頁面可能過時");
  });

  test("a quiet file is not reported, and an unreachable repo is skipped rather than failing", async () => {
    const dir = await repoWith(
      "type: decision\ntitle: a\nstatus: active\nupdated: 2026-09-01\ncode_refs:\n  - repo: 104corp/billing-batch\n    paths: [src/Quiet.java, src/Private.java]",
    );

    const report = await findStalePages(dir, {
      commitsSince: (_repo, path) => (path === "src/Quiet.java" ? { count: 0 } : null),
    });

    expect(report.findings).toEqual([]);
    expect(report.skipped[0]).toContain("gh 沒登入或沒有權限");
  });

  test("pages without code_refs are simply not checked", async () => {
    const dir = await repoWith("type: decision\ntitle: a\nstatus: active\nupdated: 2026-09-01");
    const report = await findStalePages(dir, { commitsSince: () => ({ count: 9 }) });
    expect(report.checked).toBe(0);
    expect(formatStale(report)).toContain("沒東西可以檢查");
  });
});

test("an entity slug keeps the identifier readable", () => {
  expect(entitySlug("export_job")).toBe("export_job"); // a table name is an identifier
  expect(entitySlug("GET /exports/{id}")).toBe("get-exports-id");
  expect(entitySlug("SAP")).toBe("sap");
});
