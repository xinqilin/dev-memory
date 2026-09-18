import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { SCHEMA_VERSION } from "../src/core/db";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const homes: string[] = [];

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "dev-memory-home-"));
  homes.push(home);
  return join(home, ".dev-memory"); // must be created by init
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function runInit(home: string) {
  const proc = Bun.spawn(["bun", CLI, "init"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DEV_MEMORY_HOME: home },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

test("init creates the home directory, config and database", async () => {
  const home = tempHome();
  const { stdout, code } = await runInit(home);

  expect(code).toBe(0);
  expect(existsSync(join(home, "config.toml"))).toBe(true);
  expect(existsSync(join(home, "memory.db"))).toBe(true);
  expect(stdout).toContain("(created)");
  expect(stdout).toContain(`schema v${SCHEMA_VERSION}`);
  expect(stdout).toContain("FTS5: yes");
  expect(stdout).toContain("search      none");
});

test("re-running init keeps an edited config", async () => {
  const home = tempHome();
  await runInit(home);
  await Bun.write(join(home, "config.toml"), '[embedding]\nprovider = "ollama"\nmodel = "qwen3-embedding:0.6b"\n');

  const { stdout, code } = await runInit(home);
  expect(code).toBe(0);
  expect(stdout).toContain("(kept)");
  expect(stdout).toContain("search      ollama (qwen3-embedding:0.6b)");
});

test("unknown commands fail loudly", async () => {
  const proc = Bun.spawn(["bun", CLI, "nope"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, DEV_MEMORY_HOME: tempHome() } });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(2);
  expect(stderr).toContain("Unknown command: nope");
});
