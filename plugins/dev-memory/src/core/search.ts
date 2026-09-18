// Keyword search over the local index. Ranking is bm25 from FTS5, then the scope rules from
// PLAN.md: wiki page > record > raw turn, and same repo before everything else.
//
// Snippets come from the original text, never from the FTS body: the indexed body is
// pre-tokenized (Chinese split into bigrams), which is unreadable for a human.
import type { Database } from "bun:sqlite";
import { buildMatchQuery, queryTerms } from "./tokenize";

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
const SNIPPET_RADIUS = 60;

/** bm25 returns smaller-is-better; flip it so bigger is better and keep it on a sane scale. */
function relevance(bm25: number): number {
  return 1 / (1 + Math.max(0, -bm25));
}

export function makeSnippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const terms = queryTerms(query);
  const haystack = flat.toLowerCase();

  let at = -1;
  let hit = "";
  for (const term of terms) {
    const index = haystack.indexOf(term.toLowerCase());
    if (index !== -1 && (at === -1 || index < at)) {
      at = index;
      hit = flat.slice(index, index + term.length);
    }
  }
  if (at === -1) return flat.slice(0, SNIPPET_RADIUS * 2) + (flat.length > SNIPPET_RADIUS * 2 ? " …" : "");

  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(flat.length, at + hit.length + SNIPPET_RADIUS);
  return `${start > 0 ? "… " : ""}${flat.slice(start, at)}[${hit}]${flat.slice(at + hit.length, end)}${end < flat.length ? " …" : ""}`;
}

interface Source {
  title: string;
  body: string;
  repoId: string | null;
  ts: string | null;
}

function describe(db: Database, kind: Kind, ref: string): Source {
  if (kind === "turn") {
    const row = db.query("select role, text, repo_id, ts from turn where id = ?").get(ref) as
      | { role: string; text: string; repo_id: string | null; ts: string | null }
      | null;
    if (!row) return { title: ref, body: "", repoId: null, ts: null };
    return {
      title: `${row.role === "user" ? "使用者" : "AI"}: ${row.text.replace(/\s+/g, " ").slice(0, 40)}`,
      body: row.text,
      repoId: row.repo_id,
      ts: row.ts,
    };
  }

  if (kind === "record") {
    const row = db.query("select title, body, repos, created_at from record where id = ?").get(ref) as
      | { title: string; body: string; repos: string; created_at: string }
      | null;
    if (!row) return { title: ref, body: "", repoId: null, ts: null };
    return { title: row.title, body: row.body, repoId: (JSON.parse(row.repos) as string[])[0] ?? null, ts: row.created_at };
  }

  const row = db.query("select title, body, updated from page where path = ?").get(ref) as
    | { title: string | null; body: string; updated: string | null }
    | null;
  return { title: row?.title ?? ref, body: row?.body ?? "", repoId: null, ts: row?.updated ?? null };
}

export function search(db: Database, query: string, options: SearchOptions = {}): SearchHit[] {
  const match = buildMatchQuery(query);
  if (!match) return [];

  const limit = options.limit ?? 10;
  const kinds = options.kinds ?? (["page", "record", "turn"] as Kind[]);

  const rows = db
    .query(
      `select f.kind as kind, f.ref as ref, bm25(fts) as bm25
         from fts f
        where fts match ? and f.kind in (${kinds.map(() => "?").join(", ")})
        order by bm25(fts)
        limit ?`,
    )
    .all(match, ...kinds, limit * 5) as { kind: Kind; ref: string; bm25: number }[];

  return rows
    .map((row) => {
      const source = describe(db, row.kind, row.ref);
      const sameRepo = options.repoId && source.repoId === options.repoId ? 2 : 1;
      return {
        kind: row.kind,
        ref: row.ref,
        title: source.title,
        snippet: makeSnippet(source.body, query),
        repoId: source.repoId,
        ts: source.ts,
        score: relevance(row.bm25) * KIND_WEIGHT[row.kind] * sameRepo,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Full text behind a hit, for `memory_get` and the CLI. */
export function get(db: Database, kind: Kind, ref: string): string | null {
  const table = { turn: ["text", "turn", "id"], record: ["body", "record", "id"], page: ["body", "page", "path"] }[kind];
  const row = db.query(`select ${table[0]} as body from ${table[1]} where ${table[2]} = ?`).get(ref) as { body: string } | null;
  return row?.body ?? null;
}
