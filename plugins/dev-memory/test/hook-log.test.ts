import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookLogPath, lastHookError, logHookError } from "../src/core/hook-log";

const originalHome = process.env.DEV_MEMORY_HOME;
let dir = "";
let silence: ReturnType<typeof spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dev-memory-hook-log-"));
  process.env.DEV_MEMORY_HOME = dir;
  silence = spyOn(console, "error").mockImplementation(() => {}); // the stderr copy is not under test
});
afterEach(() => {
  silence.mockRestore();
  process.env.DEV_MEMORY_HOME = originalHome;
  rmSync(dir, { recursive: true, force: true });
});

test("a swallowed error is kept on one line, and read back as the newest entry", () => {
  expect(lastHookError()).toBeNull();

  logHookError("stop", new Error("database is locked\n    at archiveFile"));

  const last = lastHookError()!;
  expect(last.message).toBe("stop: Error: database is locked at archiveFile");
  expect(Date.now() - last.at.getTime()).toBeLessThan(60_000);
});

test("only the newest 200 lines are kept", () => {
  for (let i = 0; i < 205; i++) logHookError("stop", `failure ${i}`);

  const lines = readFileSync(hookLogPath(), "utf8").trim().split("\n");
  expect(lines).toHaveLength(200);
  expect(lines[0]).toEndWith("stop: failure 5");
  expect(lastHookError()!.message).toBe("stop: failure 204");
});
