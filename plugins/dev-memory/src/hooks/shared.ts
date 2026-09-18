// Shared hook plumbing. Kept tool-agnostic: Claude Code and Codex send the same fields,
// and Codex exposes CLAUDE_PLUGIN_ROOT as an alias, so PLUGIN_ROOT is what tells them apart.
import type { Host } from "../adapters/types";

export async function readHookPayload(): Promise<Record<string, any>> {
  try {
    const raw = await Bun.stdin.text();
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // a hook must not fail because of its input
  }
}

export function hostFromEnv(): Host {
  return process.env.PLUGIN_ROOT ? "codex" : "claude-code";
}

/** SessionStart output both tools understand: plain JSON with additionalContext. */
export function emitContext(text: string): void {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
}
