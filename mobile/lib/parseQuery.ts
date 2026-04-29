/**
 * Single-field clinic search: pull out a known city token (or bigram); rest is free-text query.
 * Align canon slugs with backend {@link ../../../lib/cityCodes.cjs} KNOWN_CODES + GET /api/city-catalog.
 */

export type ParseQueryResult = {
  /** Canonical slug when a city token matched; omit does not clear persisted city in UI — caller decides. */
  cityCode: string | null;
  /** Non-city words preserved in order */
  query: string;
};

export type CanonicalPickResult = {
  city: string | null;
  score: number;
};

/** Matches from explicit multi-word phrases in {@link CITY_BIGRAM_TO_CODE}. Strong vs unigram exact (3), not overpowering. */
export const BIGRAM_MATCH_SCORE = 3.5;

/** Prefer longer spans only when this many chars ahead (reduces meaningless length bias). */
export const TOKEN_LENGTH_TIE_MARGIN = 2;

/** Debug: ambiguous strong matches use `score` strictly above this threshold. */
export const HIGH_CONFIDENCE_CITY_THRESHOLD = 2;

/** Minimum token length before any city match is considered (reduces false positives). */
export const MIN_PARTIAL_CITY_LEN = 3;

/** Substring match (weakest tier) only for queries this long — avoids spurious `includes` hits. */
export const MIN_INCLUDES_SCORE_LEN = 4;

/**
 * NFC trim + lowercase; maps Turkish dotted/dotless **I** to ASCII `i` for stable alias scoring.
 */
export function normalizeText(input: string): string {
  return String(input || "")
    .normalize("NFC")
    .replace(/\u0130/g, "i")
    .replace(/\u0131/g, "i")
    .trim()
    .toLowerCase();
}

/**
 * Score how well user query `q` matches a normalized alias string.
 * Higher is better; 0 means no match.
 * — exact = 3
 * — alias starts with `q`, ≤2 chars to finish (near-complete: e.g. tbilis → tbilisi) = 2.5 before generic prefix
 * — alias starts with `q` (otherwise) = 2
 * — includes = 1 only if q length ≥ {@link MIN_INCLUDES_SCORE_LEN}
 */
export function scoreMatch(q: string, alias: string): number {
  if (!q.length || !alias.length) return 0;
  if (alias === q) return 3;
  if (alias.startsWith(q)) {
    if (alias.length - q.length <= 2) return 2.5;
    return 2;
  }
  if (alias.includes(q)) return q.length >= MIN_INCLUDES_SCORE_LEN ? 1 : 0;
  return 0;
}

/**
 * Canonical slug → all aliases (exact + partial-friendly: any script).
 * Order: first entry is the canonical slug used in API/DB.
 */
export const CITY_ALIAS_GROUPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  tbilisi: ["tbilisi", "tiflis", "tblisi", "tiblisi", "тбилиси", "თბილისი"],
  batumi: ["batumi", "ბათუმი"],
  kutaisi: ["kutaisi", "ქუთაისი", "кутаиси"],
  istanbul: ["istanbul"],
  ankara: ["ankara"],
  antalya: ["antalya"],
});

/** Exact normalized alias → canonical (derived from {@link CITY_ALIAS_GROUPS}). */
export const CITY_WORD_TO_CODE: Readonly<Record<string, string>> = (() => {
  const flat: Record<string, string> = {};
  for (const [code, aliases] of Object.entries(CITY_ALIAS_GROUPS)) {
    for (const al of aliases) {
      const k = normalizeText(al);
      if (k) flat[k] = code;
    }
  }
  return Object.freeze(flat);
})();

/** Grouped aliases — `CITY_ALIASES[canonicalSlug]` is the list used by {@link resolveCity}. */
export const CITY_ALIASES: Readonly<Record<string, readonly string[]>> = CITY_ALIAS_GROUPS;

/** Two-token city phrases → canonical slug (normalized with {@link normalizeText}). */
const CITY_BIGRAM_TO_CODE: Readonly<Record<string, string>> = Object.freeze({
  // Extend when backend adds slug (e.g. new york → new_york)
});

function normalizeInput(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Span 1 = unigram at `idx`; span 2 = bigram consumes `idx` and `idx + 1`. */
export type CitySpanCandidate = {
  city: string;
  score: number;
  tokenLen: number;
  /** Index of first word in `words[]` forming this candidate. Earlier wins ties. */
  idx: number;
  span: 1 | 2;
};

/** `cand` is strictly better than `prev` — higher score → much longer token → earlier `idx` (left-most). */
export function isBetterCandidate(cand: CitySpanCandidate, prev: CitySpanCandidate): boolean {
  if (cand.score > prev.score) return true;
  if (cand.score < prev.score) return false;
  if (cand.tokenLen > prev.tokenLen + TOKEN_LENGTH_TIE_MARGIN) return true;
  if (prev.tokenLen > cand.tokenLen + TOKEN_LENGTH_TIE_MARGIN) return false;
  return cand.idx < prev.idx;
}

/** Warn when several strong conflicting city candidates appear (helps tune catalog / thresholds). */
export function warnMultiCityDetected(input: string, candidates: readonly CitySpanCandidate[]): void {
  const strong = candidates.filter((c) => c.score > HIGH_CONFIDENCE_CITY_THRESHOLD);
  if (strong.length > 1) {
    console.warn("MULTI CITY DETECTED", input);
  }
}

/** Bigram + unigram matches; overlaps allowed — caller picks best with {@link isBetterCandidate}. */
export function collectCityCandidates(words: string[]): CitySpanCandidate[] {
  const out: CitySpanCandidate[] = [];

  for (let i = 0; i + 1 < words.length; i += 1) {
    const bigramNormalized = normalizeText(`${words[i]} ${words[i + 1]}`);
    const city = CITY_BIGRAM_TO_CODE[bigramNormalized];
    if (city) {
      out.push({
        city,
        score: BIGRAM_MATCH_SCORE,
        tokenLen: bigramNormalized.length,
        idx: i,
        span: 2,
      });
    }
  }

  for (let idx = 0; idx < words.length; idx += 1) {
    const q = normalizeText(words[idx]);
    if (q.length < MIN_PARTIAL_CITY_LEN) continue;
    const { city, score } = pickBestCanonicalForQuery(q);
    if (!city || score <= 0) continue;
    out.push({
      city,
      score,
      tokenLen: q.length,
      idx,
      span: 1,
    });
  }

  return out;
}

function pickBestFromCandidates(candidates: CitySpanCandidate[]): CitySpanCandidate | null {
  let best: CitySpanCandidate | null = null;
  for (const cand of candidates) {
    if (!best || isBetterCandidate(cand, best)) best = cand;
  }
  return best;
}

function pickBestCityWithDiagnostics(words: string[], inputLogged: string): CitySpanCandidate | null {
  const candidates = collectCityCandidates(words);
  warnMultiCityDetected(inputLogged, candidates);
  return pickBestFromCandidates(candidates);
}

/**
 * Best canonical city + score for one normalized token (all aliases evaluated).
 */
export function pickBestCanonicalForQuery(q: string): CanonicalPickResult {
  if (q.length < MIN_PARTIAL_CITY_LEN) {
    return { city: null, score: 0 };
  }

  let bestCanon: string | null = null;
  let bestScore = -1;
  let bestAliasLen = -1;

  for (const [canon, aliases] of Object.entries(CITY_ALIAS_GROUPS)) {
    for (const rawAlias of aliases) {
      const a = normalizeText(rawAlias);
      if (!a.length) continue;
      const s = scoreMatch(q, a);
      if (s === 0) continue;
      if (
        s > bestScore ||
        (s === bestScore && a.length > bestAliasLen) ||
        (s === bestScore && a.length === bestAliasLen && bestCanon != null && canon < bestCanon)
      ) {
        bestScore = s;
        bestCanon = canon;
        bestAliasLen = a.length;
      }
    }
  }

  return bestCanon != null && bestScore >= 0
    ? { city: bestCanon, score: bestScore }
    : { city: null, score: 0 };
}

/**
 * Resolve canonical city: evaluate **bigrams + unigrams**, return globally best by {@link isBetterCandidate}.
 */
export function resolveCity(input: string): string | null {
  const normalized = normalizeInput(input);
  if (!normalized) return null;

  const words = normalized.split(" ").filter(Boolean);
  const best = pickBestCityWithDiagnostics(words, normalized);
  return best?.city ?? null;
}

/**
 * Parse search text for embedded city synonyms.
 * Wins the single **best-scoring span** ({@link resolveCity} rules): bigrams compete at score {@link BIGRAM_MATCH_SCORE}.
 */
export function parseQuery(input: string): ParseQueryResult {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return { cityCode: null, query: "" };
  }

  const words = normalized.split(" ").filter(Boolean);
  const best = pickBestCityWithDiagnostics(words, normalized);

  const cityCode = best?.city ?? null;

  const consumed =
    best == null ? new Set<number>() : best.span === 2 ? new Set<number>([best.idx, best.idx + 1]) : new Set<number>([best.idx]);

  const remaining = words
    .map((_, idx) => (consumed.has(idx) ? null : words[idx]))
    .filter((part): part is string => part != null);
  const query = remaining.join(" ").trim();

  return { cityCode, query };
}
