// Pull the memory repo's main branch into the local index.
//
// Everything is read through git plumbing against origin/<branch>, never from the working
// tree: the author may be in the middle of an ingest, and a half-written page must not become
// a search hit. Sync only adds rows and marks cards merged, so it is always safe to re-run.
import type { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { DOC_DIRS } from "./lint";
import { tokenizeForIndex } from "./tokenize";

export interface SyncResult {
  records: { imported: number; alreadyThere: number; markedMerged: number };
  pages: { imported: number; removed: number };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** A document's title is its first level-one heading; there is no frontmatter to read it from. */
export function headingTitle(text: string): string | null {
  return text.match(/^#\s+(.+)$/m)?.[1].trim() ?? null;
}

export function parseFrontmatter(text: string): { frontmatter: Record<string, any>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: text };
  try {
    return { frontmatter: (Bun.YAML.parse(match[1]) ?? {}) as Record<string, any>, body: match[2] };
  } catch {
    return { frontmatter: {}, body: match[2] }; // a broken page is still readable text
  }
}

export interface SyncOptions {
  branch?: string;
  /** Skipped in tests and when offline; the local origin/<branch> is used as-is. */
  fetch?: boolean;
}

export function sync(db: Database, repoPath: string, options: SyncOptions = {}): SyncResult {
  const branch = options.branch ?? "main";
  if (options.fetch !== false) git(repoPath, ["fetch", "origin", "--quiet"]);

  const ref = `origin/${branch}`;
  const files = git(repoPath, ["ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean);
  const read = (path: string) => git(repoPath, ["show", `${ref}:${path}`]);

  const result: SyncResult = {
    records: { imported: 0, alreadyThere: 0, markedMerged: 0 },
    pages: { imported: 0, removed: 0 },
  };

  const insertRecord = db.prepare(
    `insert or ignore into record (id, author, host, product, repos, branch, type, title, body, entities, files, commits, supersedes, content_hash, status, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'merged', ?)`,
  );
  const markMerged = db.prepare("update record set status = 'merged' where id = ? and status != 'merged'");
  const insertFts = db.prepare("insert into fts (body, kind, ref) values (?, ?, ?)");
  const deleteFts = db.prepare("delete from fts where kind = ? and ref = ?");

  db.transaction(() => {
    for (const path of files.filter((file) => file.startsWith("records/") && file.endsWith(".jsonl"))) {
      for (const line of read(path).split("\n")) {
        if (!line.trim()) continue;
        let record: Record<string, any>;
        try {
          record = JSON.parse(line);
        } catch {
          continue; // CI lints the repo; a bad line must not stop a teammate's sync
        }
        if (!record.id) continue;

        const { changes } = insertRecord.run(
          record.id,
          record.author ?? "unknown",
          record.host ?? "unknown",
          record.product ?? null,
          JSON.stringify(record.repos ?? []),
          record.branch ?? null,
          record.type ?? "note",
          record.title ?? "",
          record.body ?? "",
          JSON.stringify(record.entities ?? []),
          JSON.stringify(record.files ?? []),
          JSON.stringify(record.commits ?? []),
          record.supersedes ?? null,
          record.content_hash ?? "",
          record.created_at ?? new Date().toISOString(),
        );

        if (changes === 0) {
          result.records.alreadyThere++;
          // It was submitted from this machine and is now on main.
          result.records.markedMerged += markMerged.run(record.id).changes;
          continue;
        }
        insertFts.run(tokenizeForIndex(`${record.title ?? ""}\n${record.body ?? ""}`), "record", record.id);
        result.records.imported++;
      }
    }

    // Documents are replaced wholesale: main is the truth, the local copy is just an index.
    // README.md is navigation, not content, so it stays out of search.
    const wanted = new Set(
      files.filter((file) => file.endsWith(".md") && DOC_DIRS.some((dir) => file.startsWith(`${dir}/`))),
    );
    const existing = (db.query("select path from page").all() as { path: string }[]).map((row) => row.path);

    for (const path of existing) {
      if (wanted.has(path)) continue;
      db.run("delete from page where path = ?", [path]);
      deleteFts.run("page", path);
      result.pages.removed++;
    }

    for (const path of wanted) {
      // Documents carry no frontmatter; parseFrontmatter still handles the older pages that do.
      const { frontmatter, body } = parseFrontmatter(read(path));
      const title = frontmatter.title ?? headingTitle(body) ?? path.split("/").at(-1)!.replace(/\.md$/, "");
      db.run(
        `insert into page (path, product, type, title, status, sources, code_refs, updated, body)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(path) do update set product = excluded.product, type = excluded.type, title = excluded.title,
           status = excluded.status, sources = excluded.sources, code_refs = excluded.code_refs,
           updated = excluded.updated, body = excluded.body`,
        [
          path,
          frontmatter.product ?? null,
          frontmatter.type ?? null,
          title,
          frontmatter.status ?? "active",
          JSON.stringify(frontmatter.sources ?? []),
          JSON.stringify(frontmatter.code_refs ?? []),
          frontmatter.updated ? String(frontmatter.updated) : null,
          body,
        ],
      );
      deleteFts.run("page", path);
      // Superseded pages stay in the table for history but must not surface in search.
      if (frontmatter.status !== "superseded") {
        insertFts.run(tokenizeForIndex(`${title}\n${body}`), "page", path);
      }
      result.pages.imported++;
    }
  })();

  return result;
}
