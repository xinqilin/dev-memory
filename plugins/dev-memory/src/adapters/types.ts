// Both tools produce the same Turn shape; everything downstream only sees this.
export type Host = "claude-code" | "codex";

export interface Turn {
  id: string; // <host>:<session_id>:<line_no>
  host: Host;
  sessionId: string;
  lineNo: number; // 1-based line number in the transcript file
  ts: string | null;
  role: "user" | "agent";
  text: string;
  cwd: string | null;
  repoId: string | null; // owner/repo, null outside git
  branch: string | null;
}

export interface ParseOptions {
  /** Line number of the first line in `content`, for incremental reads that start mid-file. */
  startLineNo?: number;
}

export function turnId(host: Host, sessionId: string, lineNo: number): string {
  return `${host}:${sessionId}:${lineNo}`;
}

/** Transcript formats are not stable interfaces: a bad line is skipped, never thrown. */
export function parseJsonLine(line: string): Record<string, any> | null {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
