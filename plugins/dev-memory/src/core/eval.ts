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

export function formatReport(report: EvalReport): string {
  const lines = report.cases.map((c) => `${c.rank === null ? "miss" : `#${c.rank}  `}  ${c.id.padEnd(28)} ${c.query}`);
  return [
    ...lines,
    "",
    `Recall@${report.recallAt}: ${(report.recall * 100).toFixed(1)}%   MRR: ${report.mrr.toFixed(3)}   cases: ${report.cases.length}`,
  ].join("\n");
}
