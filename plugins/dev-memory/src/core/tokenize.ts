// Pre-tokenizer for the FTS5 index. Pair it with: tokenize = "unicode61 tokenchars '_'"
//
// - CJK runs become overlapping bigrams, because unicode61 would keep a whole run as one token.
// - Identifiers keep their full form (so WAIT_FOR_INSERT_MIDDLE_DB matches exactly) and also
//   emit camelCase / snake_case parts (so "status" finds sapStatus).

const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}`;
const SEGMENT = new RegExp(String.raw`([${CJK}]+)|((?:(?![${CJK}])[\p{L}\p{M}\p{N}_])+)`, "gu");

type Segment = { kind: "cjk" | "word"; text: string };

function* segments(text: string): Generator<Segment> {
  for (const m of text.matchAll(SEGMENT)) {
    if (m[1]) yield { kind: "cjk", text: m[1] };
    else if (m[2]) yield { kind: "word", text: m[2] };
  }
}

function bigrams(run: string): string[] {
  const chars = Array.from(run);
  if (chars.length === 1) return chars;
  return chars.slice(0, -1).map((c, i) => c + chars[i + 1]);
}

export function identifierParts(word: string): string[] {
  return word
    .split("_")
    .flatMap((piece) => piece.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u))
    .filter(Boolean)
    .map((p) => p.toLowerCase());
}

/** The query as a human reads it: CJK runs and words, not the bigrams used for matching. */
export function queryTerms(query: string): string[] {
  return [...segments(query)].map((segment) => segment.text);
}

export function tokenizeForIndex(text: string): string {
  const tokens: string[] = [];
  for (const seg of segments(text)) {
    if (seg.kind === "cjk") {
      tokens.push(...bigrams(seg.text));
      continue;
    }
    const full = seg.text.toLowerCase();
    tokens.push(full);
    const parts = identifierParts(seg.text);
    if (parts.length > 1) tokens.push(...parts);
  }
  return tokens.join(" ");
}

// Strict: every term must match (FTS5 implicit AND) and a CJK run becomes a phrase of its
// bigrams, which forces adjacency. So "例外處理" matches exactly that substring — the property the
// tokenizer was built for. Use this when substring semantics matter.
// Known limitation: a single CJK character only matches as a bigram prefix.
export function buildMatchQuery(query: string): string | null {
  const terms: string[] = [];
  for (const seg of segments(query)) {
    if (seg.kind === "word") {
      terms.push(`"${seg.text.toLowerCase()}"`);
    } else if (Array.from(seg.text).length === 1) {
      terms.push(`"${seg.text}"*`);
    } else {
      terms.push(`"${bigrams(seg.text).join(" ")}"`);
    }
  }
  return terms.length ? terms.join(" ") : null;
}

// Loose, for actual searching. A question asked months later is one long CJK run that never
// appears verbatim in the memory, so strict matching returns nothing (measured: 0% recall).
// Each run therefore contributes both the exact phrase and its individual bigrams, all OR-ed;
// bm25 then puts the documents that matched more of them first.
export function buildSearchQuery(query: string): string | null {
  const parts = [...segments(query)];
  // A lone CJK character inside a longer question is a particle (的, 是, 怎): noise, and an
  // expensive prefix scan. Keep it only when it is all the user typed.
  const kept = parts.length > 1 ? parts.filter((seg) => seg.kind === "word" || Array.from(seg.text).length > 1) : parts;

  const terms: string[] = [];
  for (const seg of kept) {
    if (seg.kind === "word") {
      terms.push(`"${seg.text.toLowerCase()}"`);
      continue;
    }
    const chars = Array.from(seg.text);
    if (chars.length === 1) {
      terms.push(`"${seg.text}"*`);
      continue;
    }
    const grams = bigrams(seg.text);
    if (grams.length > 1) terms.push(`"${grams.join(" ")}"`); // the whole run, ranked highest
    terms.push(...grams.map((gram) => `"${gram}"`));
  }

  return terms.length ? [...new Set(terms)].join(" OR ") : null;
}
