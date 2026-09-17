// Phase 0 spike: SessionStart hook shared by Claude Code and Codex CLI.
// Prints additionalContext and appends evidence to ~/.dev-memory/logs/hello-hook.log.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const raw = await Bun.stdin.text();
let payload: Record<string, unknown> = {};
try {
  payload = raw.trim() ? JSON.parse(raw) : {};
} catch {
  // Unparseable input must never break the session.
}

// Codex sets PLUGIN_ROOT (Agent Plugins); Claude Code only sets CLAUDE_PLUGIN_ROOT.
const host = process.env.PLUGIN_ROOT ? "codex" : process.env.CLAUDE_PLUGIN_ROOT ? "claude-code" : "unknown";

const evidence = {
  at: new Date().toISOString(),
  host,
  event: payload.hook_event_name ?? null,
  source: payload.source ?? payload.session_start_reason ?? null,
  payload_keys: Object.keys(payload).sort(),
  transcript_path_is_null: payload.transcript_path == null,
  env: {
    CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT ?? null,
    PLUGIN_ROOT: process.env.PLUGIN_ROOT ?? null,
  },
};

try {
  const dir = join(homedir(), ".dev-memory", "logs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "hello-hook.log"), JSON.stringify(evidence) + "\n");
} catch {
  // Logging is best effort.
}

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `DEV_MEMORY_HOOK_OK host=${host} source=${evidence.source ?? "n/a"}`,
    },
  }),
);
