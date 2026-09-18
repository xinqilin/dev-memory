// Keyword search over the local index. Ranking is bm25 from FTS5, then the scope rules from
// PLAN.md: wiki page > record > raw turn, and same repo before everything else.
import type { Database } from "bun:sqlite";
import { buildMatchQuery } from "./tokenize";

export type Kind = "page" | "record" | "turn";

export interface SearchHit {
  kind: Kind;
  ref: string;
  title: string;
  snippet: string;
  repoId: string | null;
  ts: string | null;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  /** Hits from this repo rank first; everything else still shows up. */
  repoId?: string | null;
  kinds?: Kind[];
}

const KIND_WEIGHT: Record<Kind, number> = { page: 3, record: 2, turn: 1 };

/** bm25 returns smaller-is-better; flip it so bigger is better and keep it on a sane scale. */
function relevance(bm25: number): number {
  return 1 / (1 + Math.max(0, -bm25));
}

export function search(db: Database, query: string, options: SearchOptions = {}): SearchHit[] {
  const match = buildMatchQuery(query);
  if (!match) return [];

  const limit = options.limit ?? 10;
  const kinds = options.kinds ?? (["page", "record", "turn"] as Kind[]);

  const rows = db
    .query(
      `select f.kind as kind, f.ref as ref, bm25(fts) as bm25,
              snippet(fts, 0, '[', ']', ' … ', 12) as snippet
         from fts f
        where fts match ? and f.kind in (${kinds.map(() => "?").join(", ")})
        order by bm25(fts)
        limit ?`,
    )
    .all(match, ...kinds, limit * 5) as { kind: Kind; ref: string; bm25: number; snippet: string }[];

  const hits = rows.map((row) => {
    const meta = describe(db, row.kind, row.ref);
    const sameRepo = options.repoId && meta.repoId === options.repoId ? 2 : 1;
    return {
      kind: row.kind,
      ref: row.ref,
      title: meta.title,
      snippet: row.snippet,
      repoId: meta.repoId,
      ts: meta.ts,
      score: relevance(row.bm25) * KIND_WEIGHT[row.kind] * sameRepo,
    };
  });

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function describe(db: Database, kind: Kind, ref: string): { title: string; repoId: string | null; ts: string | null } {
  if (kind === "turn") {
    const row = db.query("select role, text, repo_id, ts from turn where id = ?").get(ref) as
      | { role: string; text: string; repo_id: string | null; ts: string | null }
      | null;
    if (!row) return { title: ref, repoId: null, ts: null };
    return { title: `${row.role === "user" ? "使用者" : "AI"}: ${row.text.slice(0, 40)}`, repoId: row.repo_id, ts: row.ts };
  }

  if (kind === "record") {
    const row = db.query("select title, repos, created_at from record where id = ?").get(ref) as
      | { title: string; repos: string; created_at: string }
      | null;
    if (!row) return { title: ref, repoId: null, ts: null };
    const repos = JSON.parse(row.repos) as string[];
    return { title: row.title, repoId: repos[0] ?? null, ts: row.created_at };
  }

  const row = db.query("select title, updated from page where path = ?").get(ref) as
    | { title: string | null; updated: string | null }
    | null;
  return { title: row?.title ?? ref, repoId: null, ts: row?.updated ?? null };
}

/** Full text behind a hit, for `memory_get` and the CLI. */
export function get(db: Database, kind: Kind, ref: string): string | null {
  const table = { turn: ["text", "turn", "id"], record: ["body", "record", "id"], page: ["body", "page", "path"] }[kind];
  const row = db.query(`select ${table[0]} as body from ${table[1]} where ${table[2]} = ?`).get(ref) as { body: string } | null;
  return row?.body ?? null;
}
