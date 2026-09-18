// Codex rollouts: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//
// Conversation text appears twice: once as event_msg (user_message / agent_message) and once as
// response_item message. event_msg wins; response_item messages are only used for a role that has
// no event_msg at all in this chunk, which is what happens when a rollout is read mid-file.
import { normalizeRemote } from "../core/repo-id";
import { type ParseOptions, type Turn, parseJsonLine, turnId } from "./types";

const HOST = "codex" as const;

export interface CodexSessionContext {
  sessionId: string;
  cwd: string | null;
  repoId: string | null;
  branch: string | null;
}

export interface CodexParseOptions extends ParseOptions {
  /** Carried over from an earlier chunk when this one starts after session_meta. */
  context?: Partial<CodexSessionContext>;
}

export interface CodexParseResult {
  turns: Turn[];
  context: CodexSessionContext;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => (block?.type === "input_text" || block?.type === "output_text") && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function parseCodexRollout(content: string, options: CodexParseOptions = {}): CodexParseResult {
  const { startLineNo = 1, context: seed = {} } = options;
  const lines = content.split("\n").map((line) => parseJsonLine(line));

  const context: CodexSessionContext = {
    sessionId: seed.sessionId ?? "unknown",
    cwd: seed.cwd ?? null,
    repoId: seed.repoId ?? null,
    branch: seed.branch ?? null,
  };

  // Which roles are covered by event_msg in this chunk, so response_item duplicates can be skipped.
  const rolesFromEvents = new Set<Turn["role"]>();
  for (const entry of lines) {
    if (entry?.type !== "event_msg") continue;
    if (entry.payload?.type === "user_message") rolesFromEvents.add("user");
    if (entry.payload?.type === "agent_message") rolesFromEvents.add("agent");
  }

  const turns: Turn[] = [];
  lines.forEach((entry, index) => {
    if (!entry) return;
    const lineNo = startLineNo + index;
    const payload = entry.payload ?? {};
    const ts = typeof entry.timestamp === "string" ? entry.timestamp : null;

    if (entry.type === "session_meta") {
      context.sessionId = String(payload.session_id ?? payload.id ?? context.sessionId);
      if (typeof payload.cwd === "string") context.cwd = payload.cwd;
      const url = payload.git?.repository_url;
      context.repoId = typeof url === "string" ? normalizeRemote(url) : null;
      context.branch = typeof payload.git?.branch === "string" ? payload.git.branch : null;
      return;
    }

    if (entry.type === "turn_context") {
      if (typeof payload.cwd === "string") context.cwd = payload.cwd; // the user can change directory mid-session
      return;
    }

    let role: Turn["role"] | null = null;
    let text = "";

    if (entry.type === "event_msg" && payload.type === "user_message" && typeof payload.message === "string") {
      role = "user";
      text = payload.message.trim();
    } else if (entry.type === "event_msg" && payload.type === "agent_message" && typeof payload.message === "string") {
      role = "agent";
      text = payload.message.trim();
    } else if (entry.type === "response_item" && payload.type === "message") {
      // developer messages are system instructions, never memory.
      const candidate = payload.role === "user" ? "user" : payload.role === "assistant" ? "agent" : null;
      if (candidate && !rolesFromEvents.has(candidate)) {
        role = candidate;
        text = textFromContent(payload.content);
      }
    }
    // reasoning, function_call, function_call_output, custom_tool_call*, web_search*, token_count: dropped.

    if (!role || !text) return;
    turns.push({
      id: turnId(HOST, context.sessionId, lineNo),
      host: HOST,
      sessionId: context.sessionId,
      lineNo,
      ts,
      role,
      text,
      cwd: context.cwd,
      repoId: context.repoId,
      branch: context.branch,
    });
  });

  return { turns, context };
}
