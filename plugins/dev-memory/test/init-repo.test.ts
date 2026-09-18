import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, templateDir } from "../src/core/init-repo";

const dirs: string[] = [];
function target() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-repo-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("adds the scaffolding to an empty repository", async () => {
  const dir = target();
  const { created, kept } = await initRepo(dir);

  expect(kept).toEqual([]);
  expect(created).toEqual([
    ".gitattributes",
    ".github/workflows/lint.yml",
    "records/README.md",
    "repos.yaml",
    "schema.md",
    "tools/lint.ts",
    "wiki/index.md",
    "wiki/log.md",
  ]);
  expect(await Bun.file(join(dir, "schema.md")).text()).toContain("Memory repo 規則");
});

test("never overwrites what is already there", async () => {
  const dir = target();
  mkdirSync(join(dir, "wiki"), { recursive: true });
  await Bun.write(join(dir, "wiki", "index.md"), "# 我們自己的目錄\n");
  await Bun.write(join(dir, "repos.yaml"), "products: {}\n");

  const { created, kept } = await initRepo(dir);

  expect(kept).toEqual(["repos.yaml", "wiki/index.md"]);
  expect(created).toContain("schema.md");
  expect(await Bun.file(join(dir, "wiki", "index.md")).text()).toBe("# 我們自己的目錄\n");
});

test("existing hand-written docs are left alone", async () => {
  const dir = target();
  mkdirSync(join(dir, "maintenance"), { recursive: true });
  await Bun.write(join(dir, "maintenance", "aws.md"), "# 原本就有的文件\n");

  await initRepo(dir);

  expect(await Bun.file(join(dir, "maintenance", "aws.md")).text()).toBe("# 原本就有的文件\n");
});

test("running it twice changes nothing the second time", async () => {
  const dir = target();
  const first = await initRepo(dir);
  const second = await initRepo(dir);

  expect(second.created).toEqual([]);
  expect(second.kept).toEqual(first.created);
});

test("the template directory resolves from the plugin root", () => {
  expect(templateDir()).toContain("templates/memory-repo");
});
