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

function page(front: Record<string, unknown>, body = "內容\n") {
  const yaml = Object.entries(front)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? JSON.stringify(value) : value}`)
    .join("\n");
  return `---\n${yaml}\n---\n${body}`;
}

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

const GOOD_PAGE = page({
  type: "decision",
  title: "匯出報表改成單筆失敗不中斷",
  status: "active",
  updated: "2026-09-18",
  sources: [RECORD.id],
});

test("a well-formed repo passes", async () => {
  const dir = await repo({
    "records/billing/2026-09/bill.lin.jsonl": JSON.stringify(RECORD) + "\n",
    "wiki/index.md": "# 目錄\n- [匯出報表](billing/decisions/export.md)\n",
    "wiki/billing/decisions/export.md": GOOD_PAGE,
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(0);
  expect(out).toContain("1 pages, 1 records, 0 errors, 0 warnings");
});

test("catches broken records", async () => {
  const dir = await repo({
    "records/billing/2026-09/bill.lin.jsonl": [
      JSON.stringify(RECORD),
      JSON.stringify(RECORD), // duplicate id
      JSON.stringify({ ...RECORD, id: "01JBFIXTURE0000000000000002", title: undefined }),
      JSON.stringify({ ...RECORD, id: "01JBFIXTURE0000000000000003", content_hash: "abc" }),
      "{ not json",
    ].join("\n"),
    "records/loose.jsonl": JSON.stringify({ ...RECORD, id: "01JBFIXTURE0000000000000004" }) + "\n",
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(1);
  expect(out).toContain("duplicate id");
  expect(out).toContain('missing "title"');
  expect(out).toContain("content_hash must start with sha256:");
  expect(out).toContain("not valid JSON");
  expect(out).toContain("path must be records/<product>/<yyyy-mm>/<author>.jsonl");
});

test("catches broken pages", async () => {
  const dir = await repo({
    "records/billing/2026-09/bill.lin.jsonl": JSON.stringify(RECORD) + "\n",
    "wiki/index.md": "# 目錄\n- [a](billing/decisions/a.md)\n- [b](billing/decisions/b.md)\n- [c](billing/decisions/c.md)\n- [d](billing/decisions/d.md)\n",
    "wiki/billing/decisions/a.md": "沒有 frontmatter\n",
    "wiki/billing/decisions/b.md": page({ type: "guess", title: "t", status: "draft", updated: "2026-09-18", sources: [RECORD.id] }),
    "wiki/billing/decisions/c.md": page({ type: "decision", title: "t", status: "superseded", updated: "2026-09-18", sources: ["01JBMISSING000000000000000"] }),
    "wiki/billing/decisions/d.md": page({ type: "decision", title: "t", status: "active", updated: "2026-09-18", sources: [RECORD.id] }, "看 [[nowhere]]\n"),
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(1);
  expect(out).toContain("missing YAML frontmatter");
  expect(out).toContain('unknown type "guess"');
  expect(out).toContain('unknown status "draft"');
  expect(out).toContain("superseded pages need superseded_by");
  expect(out).toContain("sources[] points at a record that does not exist");
  expect(out).toContain("broken link [[nowhere]]");
});

test("an orphan page and a page without sources are warnings, not errors", async () => {
  const dir = await repo({
    "records/billing/2026-09/bill.lin.jsonl": JSON.stringify(RECORD) + "\n",
    "wiki/index.md": "# 目錄\n",
    "wiki/billing/decisions/orphan.md": page({ type: "decision", title: "t", status: "active", updated: "2026-09-18" }),
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(0);
  expect(out).toContain("not linked from wiki/index.md");
  expect(out).toContain("no sources[]");
  expect(out).toContain("0 errors, 2 warnings");
});

test("hand-written docs outside wiki/ and records/ are ignored", async () => {
  const dir = await repo({
    "maintenance/aws.md": "# 沒有 frontmatter 的既有文件\n",
    "README.md": "# repo\n",
  });

  const { out, code } = await lint(dir);
  expect(code).toBe(0);
  expect(out).toContain("0 pages, 0 records, 0 errors");
});
