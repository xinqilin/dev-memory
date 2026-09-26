// Incremental transcript archiving. The Stop hook runs this on every turn, so it must be cheap:
// each file is read from the byte offset recorded last time, and only whole lines are consumed.
import type { Database } from "bun:sqlite";
import { Glob } from "bun";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseClaudeTranscript } from "../adapters/claude-code";
import { type CodexSessionContext, parseCodexRollout } from "../adapters/codex";
import type { Host, Turn } from "../adapters/types";
import { redactSecrets } from "./secrets";
import { tokenizeForIndex } from "./tokenize";

export interface ArchiveResult {
  path: string;
  host: Host;
  inserted: number;
  duplicates: number;
  bytes: number;
}

interface Cursor {
  byteOffset: number;
  lineNo: number;
}

function readCursor(db: Database, path: string): Cursor {
  const row = db.query("select byte_offset, line_no from archive_cursor where path = ?").get(path) as
    | { byte_offset: number; line_no: number }
    | null;
  return row ? { byteOffset: row.byte_offset, lineNo: row.line_no } : { byteOffset: 0, lineNo: 0 };
}

/** Codex chunks after the first one have no session_meta, so the first line is re-read for context. */
async function codexContext(path: string): Promise<Partial<CodexSessionContext>> {
  const head = await Bun.file(path).slice(0, 64 * 1024).text();
  const firstLine = head.split("\n", 1)[0] ?? "";
  return parseCodexRollout(firstLine).context;
}

/** A session run under an excluded directory (config.toml [capture]) is skipped, never stored. */
function isExcluded(cwd: string | null, exclude: string[]): boolean {
  if (!cwd) return false;
  return exclude.some((dir) => {
    const root = dir.replace(/\/+$/, "");
    return cwd === root || cwd.startsWith(`${root}/`);
  });
}

export function storeTurns(db: Database, turns: Turn[]): { inserted: number; duplicates: number } {
  const insertTurn = db.prepare(
    `insert or ignore into turn (id, host, session_id, line_no, ts, role, text, cwd, repo_id, branch)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFts = db.prepare("insert into fts (body, kind, ref) values (?, 'turn', ?)");

  let inserted = 0;
  let duplicates = 0;
  db.transaction(() => {
    for (const turn of turns) {
      // A token pasted into a prompt would otherwise outlive the transcript it came from.
      const text = redactSecrets(turn.text);
      const { changes } = insertTurn.run(
        turn.id,
        turn.host,
        turn.sessionId,
        turn.lineNo,
        turn.ts,
        turn.role,
        text,
        turn.cwd,
        turn.repoId,
        turn.branch,
      );
      if (changes === 0) {
        duplicates++;
        continue; // already archived: never index it twice
      }
      insertFts.run(tokenizeForIndex(text), turn.id);
      inserted++;
    }
  })();
  return { inserted, duplicates };
}

/** `exclude` is config.capture.exclude; the caller passes it so this module never reads the real config. */
export async function archiveFile(db: Database, path: string, host: Host, exclude: string[] = []): Promise<ArchiveResult> {
  const file = Bun.file(path);
  const size = file.size;
  let { byteOffset, lineNo } = readCursor(db, path);
  if (size < byteOffset) ({ byteOffset, lineNo } = { byteOffset: 0, lineNo: 0 }); // truncated or replaced

  const empty: ArchiveResult = { path, host, inserted: 0, duplicates: 0, bytes: 0 };
  if (size === byteOffset) return empty;

  const chunk = await file.slice(byteOffset).text();
  const lastNewline = chunk.lastIndexOf("\n");
  if (lastNewline === -1) return empty; // a partial line: wait for the writer to finish it

  const consumed = chunk.slice(0, lastNewline + 1);
  const bytes = Buffer.byteLength(consumed, "utf8");
  const lines = consumed.split("\n").slice(0, -1); // drop the empty tail after the final newline

  const turns =
    host === "claude-code"
      ? parseClaudeTranscript(consumed, { startLineNo: lineNo + 1 })
      : parseCodexRollout(consumed, {
          startLineNo: lineNo + 1,
          context: byteOffset === 0 ? undefined : await codexContext(path),
        }).turns;

  // Excluded lines are still consumed, so they are skipped for good rather than read again later.
  const { inserted, duplicates } = storeTurns(db, turns.filter((turn) => !isExcluded(turn.cwd, exclude)));
  db.run(
    `insert into archive_cursor (path, byte_offset, line_no, updated_at) values (?, ?, ?, datetime('now'))
     on conflict(path) do update set byte_offset = excluded.byte_offset, line_no = excluded.line_no, updated_at = excluded.updated_at`,
    [path, byteOffset + bytes, lineNo + lines.length],
  );

  return { path, host, inserted, duplicates, bytes };
}

export interface SweepOptions {
  claudeRoot?: string;
  codexRoot?: string;
  exclude?: string[];
}

/** Scans both tools' transcript directories. Used by SessionStart to catch anything Stop missed. */
export async function sweep(db: Database, options: SweepOptions = {}): Promise<ArchiveResult[]> {
  // The env overrides exist so tests never touch the real transcript directories.
  const claudeRoot = options.claudeRoot ?? process.env.DEV_MEMORY_CLAUDE_ROOT ?? join(homedir(), ".claude", "projects");
  const codexRoot = options.codexRoot ?? process.env.DEV_MEMORY_CODEX_ROOT ?? join(homedir(), ".codex", "sessions");
  const results: ArchiveResult[] = [];

  for (const [root, pattern, host] of [
    [claudeRoot, "*/*.jsonl", "claude-code"],
    [codexRoot, "*/*/*/rollout-*.jsonl", "codex"],
  ] as const) {
    for await (const path of new Glob(pattern).scan({ cwd: root, absolute: true })) {
      try {
        results.push(await archiveFile(db, path, host, options.exclude));
      } catch (error) {
        // A single unreadable transcript must never stop the sweep or the session.
        console.error(`dev-memory: skipped ${path}: ${error}`);
      }
    }
  }
  return results;
}

export function totals(results: ArchiveResult[]): { files: number; inserted: number; duplicates: number } {
  return results.reduce(
    (acc, r) => ({ files: acc.files + (r.inserted > 0 ? 1 : 0), inserted: acc.inserted + r.inserted, duplicates: acc.duplicates + r.duplicates }),
    { files: 0, inserted: 0, duplicates: 0 },
  );
}
