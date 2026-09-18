// Claude Code transcripts: ~/.claude/projects/<slug>/<session>.jsonl
// Only `user` and `assistant` lines carry conversation; everything else
// (attachment, mode, permission-mode, ai-title, last-prompt, atis-latch) is harness bookkeeping.
import { repoIdFromDir } from "../core/repo-id";
import { type ParseOptions, type Turn, parseJsonLine, turnId } from "./types";

const HOST = "claude-code" as const;

// Lines whose text is only harness plumbing. Dropping the whole line is intentional:
// these never contain anything the author actually said.
const DROP_PATTERNS = [
  /<command-(name|message|args)>/,
  /<local-command-std(out|err)>/,
  /<task-notification>/,
  /^\[Request interrupted/,
];

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

export interface ClaudeParseOptions extends ParseOptions {
  /** Injected in tests; defaults to reading the git remote of the line's cwd. */
  resolveRepoId?: (cwd: string) => string | null;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  // thinking / tool_use / tool_result / image blocks are all dropped.
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

export function parseClaudeTranscript(content: string, options: ClaudeParseOptions = {}): Turn[] {
  const { startLineNo = 1, resolveRepoId = repoIdFromDir } = options;
  const repoCache = new Map<string, string | null>();
  const turns: Turn[] = [];

  content.split("\n").forEach((line, index) => {
    const lineNo = startLineNo + index;
    const entry = parseJsonLine(line);
    if (!entry) return;
    if (entry.type !== "user" && entry.type !== "assistant") return;
    if (entry.isSidechain || entry.isMeta) return; // subagent chatter and harness notices

    const raw = textFromContent(entry.message?.content);
    if (DROP_PATTERNS.some((pattern) => pattern.test(raw))) return;

    const text = raw.replace(SYSTEM_REMINDER, "").trim();
    if (!text) return;

    const cwd = typeof entry.cwd === "string" ? entry.cwd : null;
    if (cwd && !repoCache.has(cwd)) repoCache.set(cwd, resolveRepoId(cwd));

    const sessionId = String(entry.sessionId ?? entry.session_id ?? "unknown");
    turns.push({
      id: turnId(HOST, sessionId, lineNo),
      host: HOST,
      sessionId,
      lineNo,
      ts: typeof entry.timestamp === "string" ? entry.timestamp : null,
      role: entry.type === "user" ? "user" : "agent",
      text,
      cwd,
      repoId: cwd ? (repoCache.get(cwd) ?? null) : null,
      branch: typeof entry.gitBranch === "string" && entry.gitBranch ? entry.gitBranch : null,
    });
  });

  return turns;
}
