import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LINT = join(import.meta.dir, "..", "..", "..", "templates", "memory-repo", "tools", "lint.ts");
const dirs: string[] = [];

const RECORD = {
  id: "01JBFIXTURE0000000000000001",
  author: "bill.lin",
  host: "claude-code",
  type: "decision",
  title: "匯出報表改成單筆失敗不中斷",
  body: "原因：…\n決定：…\n放棄：…",
  content_hash: "sha256:abc",
  created_at: "2026-09-18T01:00:00.000Z",
};

const DOC = `# 匯出報表

匯出報表的完整資料流，排程每日 05:35。

## 整體流程

BU 呼叫 API，寫入中介表，批次拋轉。
`;

async function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-lint-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    await Bun.write(join(dir, path), content);
  }
  return dir;
}

async function lint(dir: string) {
  const proc = Bun.spawn(["bun", LINT, "--root", dir], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: stdout + stderr, code };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a well-formed repo passes", async () => {
  const dir = await repo({
    "records/billing/2026-09/bill.lin.jsonl": JSON.stringify(RECORD) + "\n",
    "README.md": "# 目錄\n1. [匯出報表](./spec/export.md)\n",
    "spec/export.md": DOC,
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(0);
  expect(out).toContain("1 docs, 1 records, 0 errors, 0 warnings");
});

test("catches broken records", async () => {
  const dir = await repo({
    "records/billing/2026-09/bill.lin.jsonl": `${JSON.stringify(RECORD)}\n{ not json\n`,
    "README.md": "# 目錄\n",
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(1);
  expect(out).toContain("not valid JSON");
});

test("a link that points nowhere is an error", async () => {
  const dir = await repo({
    "README.md": "# 目錄\n1. [匯出報表](./spec/export.md)\n",
    "spec/export.md": `${DOC}\n見 [排程表](../config/batch-schedule.md)。\n`,
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(1);
  expect(out).toContain("broken link: ../config/batch-schedule.md");
});

test("a link that resolves is fine, including one to a directory README", async () => {
  const dir = await repo({
    "README.md": "# 目錄\n1. [匯出報表](./spec/export.md)\n2. [排程](./config/batch-schedule.md)\n",
    "spec/export.md": `${DOC}\n見 [排程表](../config/batch-schedule.md) 與 [外部](https://example.com)。\n`,
    "config/batch-schedule.md": "# 排程\n",
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(0);
  expect(out).toContain("2 docs");
});

test("a document README never links to is an error, because nobody finds it", async () => {
  const dir = await repo({
    "README.md": "# 目錄\n",
    "spec/export.md": DOC,
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(1);
  expect(out).toContain("not linked from README.md");
});

test("tooling and raw material are not documents", async () => {
  const dir = await repo({
    "README.md": "# 目錄\n",
    "records/README.md": "# 紀錄\n",
    "schema.md": "# 規則\n",
    "records/billing/2026-09/bill.lin.jsonl": JSON.stringify(RECORD) + "\n",
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(0);
  expect(out).toContain("0 docs, 1 records");
});

test("two documents under the same heading are a warning, not an error", async () => {
  const dir = await repo({
    "README.md": "# 目錄\n1. [甲](./spec/a.md)\n2. [乙](./spec/b.md)\n",
    "spec/a.md": "# 測評點數拋轉 ERP\n\n第一份。\n",
    "spec/b.md": "# 測評點數拋轉 ERP\n\n有人又寫了一份。\n",
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(0); // a warning: sometimes it is deliberate, so it does not block
  expect(out).toContain('title "測評點數拋轉 ERP" is also used by');
  expect(out).toContain("0 errors, 2 warnings");
});

test("supersedes must name a record that exists", async () => {
  const replacement = { ...RECORD, id: "01JBFIXTURE0000000000000002", supersedes: "01JBFIXTURE0000000000000099" };
  const dir = await repo({
    "README.md": "# 目錄\n",
    "records/billing/2026-09/bill.lin.jsonl": `${JSON.stringify(RECORD)}\n${JSON.stringify(replacement)}\n`,
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(1);
  expect(out).toContain("supersedes points at a record that is not in this repo: 01JBFIXTURE0000000000000099");
});

test("supersedes pointing at a record in the same repo is fine", async () => {
  const replacement = { ...RECORD, id: "01JBFIXTURE0000000000000002", supersedes: RECORD.id };
  const dir = await repo({
    "README.md": "# 目錄\n",
    "records/billing/2026-09/bill.lin.jsonl": `${JSON.stringify(RECORD)}\n${JSON.stringify(replacement)}\n`,
  });

  const { code } = await lint(dir);
  expect(code).toBe(0);
});
