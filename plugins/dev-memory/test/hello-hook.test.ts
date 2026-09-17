import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "src", "hello-hook.ts");

async function runHook(stdin: string, env: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), "dev-memory-hook-"));
  const { CLAUDE_PLUGIN_ROOT, PLUGIN_ROOT, ...base } = process.env;
  const proc = Bun.spawn(["bun", HOOK], { stdin: "pipe", stdout: "pipe", env: { ...base, HOME: home, ...env } });
  proc.stdin.write(stdin);
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  const log = readFileSync(join(home, ".dev-memory", "logs", "hello-hook.log"), "utf8").trim();
  return { output: JSON.parse(out), evidence: JSON.parse(log) };
}

test("Claude Code style payload", async () => {
  const payload = { session_id: "s1", transcript_path: "/x.jsonl", cwd: "/repo", hook_event_name: "SessionStart", source: "startup" };
  const { output, evidence } = await runHook(JSON.stringify(payload), { CLAUDE_PLUGIN_ROOT: "/p" });
  expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(output.hookSpecificOutput.additionalContext).toBe("DEV_MEMORY_HOOK_OK host=claude-code source=startup");
  expect(evidence.transcript_path_is_null).toBe(false);
});

test("Codex style payload with null transcript_path", async () => {
  const payload = { session_id: "s2", transcript_path: null, cwd: "/repo", hook_event_name: "SessionStart", source: "resume" };
  const { output, evidence } = await runHook(JSON.stringify(payload), { CLAUDE_PLUGIN_ROOT: "/p", PLUGIN_ROOT: "/p" });
  expect(output.hookSpecificOutput.additionalContext).toBe("DEV_MEMORY_HOOK_OK host=codex source=resume");
  expect(evidence.transcript_path_is_null).toBe(true);
});

test("garbage stdin does not fail the hook", async () => {
  const { output } = await runHook("not json", {});
  expect(output.hookSpecificOutput.additionalContext).toBe("DEV_MEMORY_HOOK_OK host=unknown source=n/a");
});
