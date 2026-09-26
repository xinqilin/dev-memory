import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexExistingDocs } from "../src/core/index-docs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-index-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    await Bun.write(join(dir, path), content);
  }
  return dir;
}

const readme = (dir: string) => Bun.file(join(dir, "README.md")).text();

test("lists the documents README does not reach, with links relative to the repo root", async () => {
  const dir = await repo({
    "README.md": "# 索引\n\n1. [排程](./config/batch-schedule.md)\n",
    "config/batch-schedule.md": "# 排程表\n",
    "spec/payment-3ds.md": "# 信用卡 3DS 付款\n",
    "maintenance/aws.md": "# AWS 維運\n",
  });

  const result = await indexExistingDocs(dir);
  expect(result.docs).toEqual(["maintenance/aws.md", "spec/payment-3ds.md"]);
  expect(result.alreadyIndexed).toBe(1); // batch-schedule.md was already linked
  expect(result.changed).toBe(true);

  const text = await readme(dir);
  expect(text).toContain("[信用卡 3DS 付款](./spec/payment-3ds.md)");
  expect(text).toContain("[AWS 維運](./maintenance/aws.md)"); // title comes from the H1
  expect(text).toContain("1. [排程](./config/batch-schedule.md)"); // the original index is untouched
});

test("a document with no heading falls back to its filename", async () => {
  const dir = await repo({ "README.md": "# 索引\n", "spec/no-heading.md": "沒有標題的文件\n" });

  await indexExistingDocs(dir);
  expect(await readme(dir)).toContain("[no-heading](./spec/no-heading.md)");
});

test("raw material, tooling and the index itself are never listed", async () => {
  const dir = await repo({
    "README.md": "# 索引\n",
    "schema.md": "# 規則\n",
    "records/README.md": "# 紀錄\n",
    "tools/notes.md": "# 工具\n",
    ".github/PULL_REQUEST_TEMPLATE.md": "# PR\n",
    "CLAUDE.md": "# 給 AI 的指示\n",
    "spec/CLAUDE.md": "# 也是給 AI 的\n",
    "spec/real.md": "# 真的文件\n",
  });

  const result = await indexExistingDocs(dir);
  expect(result.docs).toEqual(["spec/real.md"]);
});

test("running twice changes nothing the second time", async () => {
  const dir = await repo({ "README.md": "# 索引\n", "spec/a.md": "# 甲\n" });

  expect((await indexExistingDocs(dir)).changed).toBe(true);
  const after = await readme(dir);

  const second = await indexExistingDocs(dir);
  expect(second.changed).toBe(false);
  expect(second.docs).toEqual(["spec/a.md"]); // still listed, not double-counted as indexed
  expect(await readme(dir)).toBe(after);
});

test("a document removed from disk leaves the section", async () => {
  const dir = await repo({ "README.md": "# 索引\n", "spec/a.md": "# 甲\n", "spec/b.md": "# 乙\n" });
  await indexExistingDocs(dir);
  expect(await readme(dir)).toContain("./spec/b.md");

  rmSync(join(dir, "spec", "b.md"));
  const result = await indexExistingDocs(dir);
  expect(result.docs).toEqual(["spec/a.md"]);
  expect(await readme(dir)).not.toContain("./spec/b.md");
});

test("sections after the list survive", async () => {
  const dir = await repo({
    "README.md": "# 索引\n\n## 既有的人工文件\n\n舊的\n\n## 怎麼貢獻\n\n照流程走。\n",
    "spec/a.md": "# 甲\n",
  });

  await indexExistingDocs(dir);
  const text = await readme(dir);
  expect(text).toContain("## 怎麼貢獻");
  expect(text).toContain("照流程走。");
  expect(text).not.toContain("舊的");
});
