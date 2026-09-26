// Writing local records into the memory repo worktree as JSONL.
//
// One file per author per month per product, append-only. That layout keeps two people submitting
// in the same month out of each other's files. It does not keep one person's two open PRs apart:
// both append to the end of the same file, and the second to merge conflicts. Resolving that is
// always "keep both sides" — line order means nothing here, and dropping a side loses cards silently.
import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readReposYaml } from "./repos";

export interface ExportResult {
  files: string[];
  written: number;
  alreadyThere: number;
  /** Local cards left on this machine because none of their repos is listed in repos.yaml. */
  outOfScope: number;
}

interface Row {
  id: string;
  author: string;
  host: string;
  product: string | null;
  repos: string;
  branch: string | null;
  type: string;
  title: string;
  body: string;
  entities: string;
  files: string;
  commits: string;
  supersedes: string | null;
  content_hash: string;
  created_at: string;
}

function recordPath(row: Row): string {
  const product = row.product?.trim() || "unsorted";
  const month = row.created_at.slice(0, 7); // YYYY-MM
  const author = row.author.replace(/[^A-Za-z0-9._-]+/g, "-");
  return join("records", product, month, `${author}.jsonl`);
}

function toJson(row: Row): string {
  return JSON.stringify({
    id: row.id,
    author: row.author,
    host: row.host,
    product: row.product ?? undefined,
    repos: JSON.parse(row.repos),
    branch: row.branch ?? undefined,
    type: row.type,
    title: row.title,
    body: row.body,
    entities: JSON.parse(row.entities),
    files: JSON.parse(row.files),
    commits: JSON.parse(row.commits),
    supersedes: row.supersedes,
    content_hash: row.content_hash,
    created_at: row.created_at,
  });
}

export interface ExportOptions {
  /** Exactly these ids, whatever their repos; defaults to every local card that belongs to this repo. */
  ids?: string[];
  markSubmitted?: boolean;
}

/**
 * The code repos this memory repo covers, read from the branch being written to. A card belongs here
 * only if it was saved in one of them: a note from another project, or from a directory that is not
 * a repo at all, must never ride along into this team's PR.
 */
async function reposInScope(worktree: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const entries of (await readReposYaml(worktree)).values()) {
    for (const entry of entries) ids.add(entry.id.toLowerCase()); // GitHub names are case-insensitive
  }
  return ids;
}

export async function exportRecords(db: Database, worktree: string, options: ExportOptions = {}): Promise<ExportResult> {
  let rows: Row[];
  let outOfScope = 0;
  if (options.ids?.length) {
    rows = db.query(`select * from record where id in (${options.ids.map(() => "?").join(", ")})`).all(...options.ids) as Row[];
  } else {
    const local = db.query("select * from record where status = 'local' order by created_at").all() as Row[];
    const scope = await reposInScope(worktree);
    rows = local.filter((row) => (JSON.parse(row.repos) as unknown[]).some((repo) => scope.has(String(repo).toLowerCase())));
    outOfScope = local.length - rows.length;
  }

  const byFile = new Map<string, Row[]>();
  for (const row of rows) {
    const path = recordPath(row);
    byFile.set(path, [...(byFile.get(path) ?? []), row]);
  }

  const result: ExportResult = { files: [], written: 0, alreadyThere: 0, outOfScope };

  for (const [relative, records] of byFile) {
    const full = join(worktree, relative);
    mkdirSync(dirname(full), { recursive: true });

    const file = Bun.file(full);
    const existing = (await file.exists()) ? await file.text() : "";
    const seen = recordIds(existing);

    const lines: string[] = [];
    for (const row of records) {
      if (seen.has(row.id)) {
        result.alreadyThere++;
        continue;
      }
      lines.push(toJson(row));
      result.written++;
    }
    if (lines.length === 0) continue;

    // Append: existing lines are never rewritten, so a teammate's lines are never touched.
    const body = existing.endsWith("\n") || existing === "" ? existing : `${existing}\n`;
    await Bun.write(full, `${body}${lines.join("\n")}\n`);
    result.files.push(relative);
  }

  if (options.markSubmitted !== false && result.written > 0) {
    const ids = rows.map((row) => row.id);
    db.run(`update record set status = 'submitted' where status = 'local' and id in (${ids.map(() => "?").join(", ")})`, ids);
  }

  return result;
}

export function isRecordsPath(path: string): boolean {
  return path.startsWith("records/") && path.endsWith(".jsonl");
}

function recordIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const id = JSON.parse(line).id;
      if (id) ids.add(String(id));
    } catch {
      // a broken line is lint's business, not ours
    }
  }
  return ids;
}

/** The cards a records file gained on an ingest branch: in the worktree copy, not on the base branch. */
export function addedRecordIds(current: string, base: string | null): string[] {
  const before = recordIds(base ?? "");
  return [...recordIds(current)].filter((id) => !before.has(id));
}

/**
 * Undo the 'submitted' mark for cards whose ingest was thrown away, so the next ingest carries them.
 * Only 'submitted' moves: a merged card is in the repo already and must stay where it is.
 */
export function returnToLocal(db: Database, ids: string[]): number {
  if (ids.length === 0) return 0;
  return db.run(`update record set status = 'local' where status = 'submitted' and id in (${ids.map(() => "?").join(", ")})`, ids).changes;
}
