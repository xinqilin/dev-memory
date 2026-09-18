// Writing local records into the memory repo worktree as JSONL.
//
// One file per author per month per product, append-only. That layout is what keeps two people
// submitting in the same month from ever touching the same file, so their PRs cannot conflict.
import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ExportResult {
  files: string[];
  written: number;
  alreadyThere: number;
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
  /** Which ids to export; defaults to everything still local. */
  ids?: string[];
  markSubmitted?: boolean;
}

export async function exportRecords(db: Database, worktree: string, options: ExportOptions = {}): Promise<ExportResult> {
  const rows = (
    options.ids?.length
      ? db.query(`select * from record where id in (${options.ids.map(() => "?").join(", ")})`).all(...options.ids)
      : db.query("select * from record where status = 'local' order by created_at").all()
  ) as Row[];

  const byFile = new Map<string, Row[]>();
  for (const row of rows) {
    const path = recordPath(row);
    byFile.set(path, [...(byFile.get(path) ?? []), row]);
  }

  const result: ExportResult = { files: [], written: 0, alreadyThere: 0 };

  for (const [relative, records] of byFile) {
    const full = join(worktree, relative);
    mkdirSync(dirname(full), { recursive: true });

    const file = Bun.file(full);
    const existing = (await file.exists()) ? await file.text() : "";
    const seen = new Set(
      existing
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line).id as string;
          } catch {
            return "";
          }
        }),
    );

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

    // Append: existing lines are never rewritten, so a merge is always a clean append.
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
