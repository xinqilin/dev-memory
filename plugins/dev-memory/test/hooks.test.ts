import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const FIXTURES = join(import.meta.dir, "fixtures");
const HOOKS = join(import.meta.dir, "..", "src", "hooks");
const dirs: string[] = [];

async function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-hooks-"));
  dirs.push(dir);
  const claudeRoot = join(dir, "claude", "projects", "slug");
  const codexRoot = join(dir, "codex", "sessions", "2026", "09", "18");
  mkdirSync(claudeRoot, { recursive: true });
  mkdirSync(codexRoot, { recursive: true });
  await Bun.write(join(claudeRoot, "a.jsonl"), await Bun.file(join(FIXTURES, "claude-code", "session.jsonl")).text());
  await Bun.write(join(codexRoot, "rollout-x.jsonl"), await Bun.file(join(FIXTURES, "codex", "rollout.jsonl")).text());

  return {
    dir,
    transcript: join(claudeRoot, "a.jsonl"),
    env: {
      ...process.env,
      DEV_MEMORY_HOME: join(dir, "home"),
      DEV_MEMORY_CLAUDE_ROOT: join(dir, "claude", "projects"),
      DEV_MEMORY_CODEX_ROOT: join(dir, "codex", "sessions"),
    },
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function runHook(script: string, payload: unknown, env: Record<string, string>) {
  const proc = Bun.spawn(["bun", join(HOOKS, script)], {
    stdin: new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload)),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const turnCount = (home: string) => {
  const db = new Database(join(home, "memory.db"), { readonly: true });
  const n = (db.query("select count(*) as n from turn").get() as { n: number }).n;
  db.close();
  return n;
};

test("the stop hook archives the session transcript it is handed", async () => {
  const { env, transcript } = await workspace();
  const { code } = await runHook("stop.ts", { session_id: "s", transcript_path: transcript, cwd: "/repo" }, env);

  expect(code).toBe(0);
  expect(turnCount(env.DEV_MEMORY_HOME)).toBe(3); // only the Claude transcript, not the Codex one
});

test("a null transcript_path falls back to sweeping both directories", async () => {
  const { env } = await workspace();
  const { code } = await runHook("stop.ts", { session_id: "s", transcript_path: null, cwd: "/repo" }, env);

  expect(code).toBe(0);
  expect(turnCount(env.DEV_MEMORY_HOME)).toBe(5); // 3 from Claude Code + 2 from Codex
});

test("the session-start hook sweeps and reports what it found", async () => {
  const { env } = await workspace();
  const { stdout, code } = await runHook("session-start.ts", { session_id: "s", source: "startup", cwd: "/repo" }, env);

  expect(code).toBe(0);
  const output = JSON.parse(stdout);
  expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");

  const context = output.hookSpecificOutput.additionalContext as string;
  expect(context).toContain("dev-memory: 5 turns, 0 records indexed (+5 just now)");
  expect(context).toContain("Search mode: keyword only");
  expect(context).toContain("search the development memory first");
  expect(turnCount(env.DEV_MEMORY_HOME)).toBe(5);
});

test("hooks survive garbage on stdin and never fail the session", async () => {
  const { env } = await workspace();
  expect((await runHook("stop.ts", "not json", env)).code).toBe(0);

  const session = await runHook("session-start.ts", "", env);
  expect(session.code).toBe(0);
  expect(JSON.parse(session.stdout).hookSpecificOutput.additionalContext).toContain("dev-memory:");
});
