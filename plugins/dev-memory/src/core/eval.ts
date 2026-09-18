// Retrieval evaluation. Cases are written the way a teammate would ask the question, on purpose
// in different words from the stored text, so the numbers say something about real recall.
import type { Database } from "bun:sqlite";
import { type Kind, get, search } from "./search";

export interface EvalCase {
  id: string;
  query: string;
  /** A hit counts when its text contains every string in all_of, or any string in any_of. */
  expect: { all_of?: string[]; any_of?: string[] };
  repo?: string;
}

export interface CaseResult {
  id: string;
  query: string;
  rank: number | null; // 1-based position of the first relevant hit
  topRef: string | null;
}

export interface EvalReport {
  cases: CaseResult[];
  recallAt: number;
  recall: number;
  mrr: number;
}

export function parseCases(yaml: string): EvalCase[] {
  const parsed = Bun.YAML.parse(yaml) as { cases?: EvalCase[] } | null;
  const cases = parsed?.cases ?? [];
  for (const item of cases) {
    if (!item.id || !item.query || !item.expect) throw new Error(`eval case needs id, query and expect: ${JSON.stringify(item)}`);
    if (!item.expect.all_of?.length && !item.expect.any_of?.length) {
      throw new Error(`eval case ${item.id} needs expect.all_of or expect.any_of`);
    }
  }
  return cases;
}

function isRelevant(text: string, expect: EvalCase["expect"]): boolean {
  const haystack = text.toLowerCase();
  const all = expect.all_of ?? [];
  const any = expect.any_of ?? [];
  const allOk = all.length === 0 || all.every((needle) => haystack.includes(needle.toLowerCase()));
  const anyOk = any.length === 0 || any.some((needle) => haystack.includes(needle.toLowerCase()));
  return allOk && anyOk;
}

export function runEval(db: Database, cases: EvalCase[], limit = 5): EvalReport {
  const results: CaseResult[] = cases.map((item) => {
    const hits = search(db, item.query, { limit, repoId: item.repo ?? null });
    const rank = hits.findIndex((hit) => {
      const body = get(db, hit.kind as Kind, hit.ref) ?? "";
      return isRelevant(`${hit.title}\n${body}`, item.expect);
    });
    return { id: item.id, query: item.query, rank: rank === -1 ? null : rank + 1, topRef: hits[0]?.ref ?? null };
  });

  const found = results.filter((r) => r.rank !== null);
  return {
    cases: results,
    recallAt: limit,
    recall: cases.length === 0 ? 0 : found.length / cases.length,
    mrr: cases.length === 0 ? 0 : found.reduce((sum, r) => sum + 1 / r.rank!, 0) / cases.length,
  };
}

/**
 * Candidate cases drawn from what the memory actually holds. The query is seeded with the title,
 * which is exactly what an eval must NOT stay as: the point is to ask in different words from the
 * stored text. So these are a starting point for a person to rewrite, never a finished suite.
 */
export function suggestCases(db: Database, limit = 30): string {
  const rows = [
    ...(db.query("select 'page' as kind, path as ref, title, body from page where status != 'superseded' order by updated desc limit ?").all(limit) as any[]),
    ...(db.query("select 'record' as kind, id as ref, title, body from record order by created_at desc limit ?").all(limit) as any[]),
  ].slice(0, limit);

  if (rows.length === 0) return "cases: []\n# 記憶裡還沒有紀錄或頁面，先 sweep 或 sync 再來。\n";

  const lines = [
    "# 候選評測題目，從現有的記憶生出來的。",
    "# 請把每題的 query 改寫成「半年後你會怎麼問」——用跟內文不一樣的說法，那才測得出 recall。",
    "# expect 是判斷命中的關鍵詞，需要的話自己調整。",
    "",
    "cases:",
  ];

  rows.forEach((row, index) => {
    const title = String(row.title ?? "").replace(/"/g, "'");
    const terms = distinctiveTerms(String(row.body ?? ""));
    lines.push(`  - id: case-${String(index + 1).padStart(2, "0")}`);
    lines.push(`    query: "${title}"   # ← 改成你自己的問法`);
    lines.push(`    expect:`);
    lines.push(`      any_of: [${terms.map((term) => `"${term}"`).join(", ") || `"${title}"`}]`);
  });

  return lines.join("\n") + "\n";
}

/** Identifiers and long-ish words carry more signal than common Chinese words. */
function distinctiveTerms(body: string): string[] {
  const identifiers = [...body.matchAll(/[A-Za-z][A-Za-z0-9_]{5,}/g)].map((match) => match[0]);
  const numbers = [...body.matchAll(/\b\d+(?:[.,]\d+)?%?\b/g)].map((match) => match[0]).filter((value) => value.length > 1);
  return [...new Set([...identifiers, ...numbers])].slice(0, 3);
}

export function formatReport(report: EvalReport): string {
  const lines = report.cases.map((c) => `${c.rank === null ? "miss" : `#${c.rank}  `}  ${c.id.padEnd(28)} ${c.query}`);
  return [
    ...lines,
    "",
    `Recall@${report.recallAt}: ${(report.recall * 100).toFixed(1)}%   MRR: ${report.mrr.toFixed(3)}   cases: ${report.cases.length}`,
  ].join("\n");
}
