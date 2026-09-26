import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, ensureConfig, loadConfig } from "../src/core/config";

const originalHome = process.env.DEV_MEMORY_HOME;
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dev-memory-config-"));
  process.env.DEV_MEMORY_HOME = dir;
});
afterEach(() => {
  process.env.DEV_MEMORY_HOME = originalHome;
  rmSync(dir, { recursive: true, force: true });
});

test("the default config excludes nothing, whether the file is missing or freshly written", async () => {
  expect((await loadConfig()).capture.exclude).toEqual([]);
  await ensureConfig();
  expect((await loadConfig()).capture.exclude).toEqual([]);
});

test("excluded directories are read with ~ expanded and blanks dropped", async () => {
  await Bun.write(configPath(), '[capture]\nexclude = ["~/personal", "/work/customer-x/", "  "]\n');
  expect((await loadConfig()).capture.exclude).toEqual([join(homedir(), "personal"), "/work/customer-x/"]);
});
