import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binDir, writeShims } from "../src/core/shim";

const originalHome = process.env.DEV_MEMORY_HOME;
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dev-memory-shim-"));
  process.env.DEV_MEMORY_HOME = dir;
});
afterEach(() => {
  process.env.DEV_MEMORY_HOME = originalHome;
  rmSync(dir, { recursive: true, force: true });
});

test("both commands run the CLI they point at and pass every argument through", async () => {
  // A quote and a space in the path: the kind of install location that breaks naive quoting.
  const folder = join(dir, "it's here");
  mkdirSync(folder);
  const cli = join(folder, "cli.ts");
  await Bun.write(cli, "console.log(JSON.stringify(process.argv.slice(2)));\n");

  writeShims(cli);

  for (const name of ["dm", "dev-memory"]) {
    const shim = join(binDir(), name);
    expect(statSync(shim).mode & 0o111).not.toBe(0);
    const run = spawnSync(shim, ["search", "中介 表"], { encoding: "utf8" });
    expect(run.stdout.trim()).toBe('["search","中介 表"]');
  }
});

test("after a plugin update the commands point at the new version", () => {
  writeShims("/cache/dev-memory/0.7.0/src/cli.ts");
  writeShims("/cache/dev-memory/0.8.0/src/cli.ts");
  expect(readFileSync(join(binDir(), "dm"), "utf8")).toContain("/cache/dev-memory/0.8.0/src/cli.ts");
});
