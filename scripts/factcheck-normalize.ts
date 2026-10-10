// Shared by scripts/pull-factchecks.ts (Node) and the app's offline corpus (Task 2+, React Native).
// No Node APIs here (no `crypto`, `fs`) — this file is imported directly by the RN bundle.

/** Bundled fact-check entry. Re-exported from src/pipeline/corpus.ts starting Task 2. */
export type Debunk = {
  id: string;
  claim: string;
  aliases?: string[];
  rating: 'false' | 'misleading' | 'true';
  publisher: string;
  date: string;
  url: string;
  summary: string;
  lang?: string;
};

/** One Google Fact Check Tools API `claims[]` item. */
export interface ApiClaim {
  text: string;
  claimant?: string;
  claimDate?: string;
  claimReview?: ApiClaimReview[];
}

/** One `claims[].claimReview[]` entry. */
export interface ApiClaimReview {
  publisher?: { name?: string; site?: string };
  url: string;
  title?: string;
  reviewDate?: string;
  textualRating: string;
  languageCode?: string;
}

const FALSE_KEYWORDS = [
  'false',
  'fake',
  'mali',
  'peke',
  'hindi totoo',
  'walang batayan',
  'fabricated',
  'hoax',
  'scam',
  'pants on fire',
  'incorrect',
  'not true',
  'untrue',
  'no basis',
  'walang basehan',
  'baseless',
  'unsubstantiated',
  'no evidence',
  'altered',
  'manipulated',
  'ai-generated',
];

const MISLEADING_KEYWORDS = [
  'misleading',
  'nakaliligaw',
  'nakalilinlang',
  'missing context',
  'needs context',
  'kulang sa konteksto',
  'kailangan ng konteksto',
  'nangangailangan ng konteksto',
  'nakapanliligaw',
  'nakapanlilinlang',
  'hindi tumpak',
  'misrepresented',
  'out of context',
  'half true',
  'partly false',
  'mixed',
  'exaggerated',
  'distorted',
  'inaccurate',
  'satire',
];

const TRUE_KEYWORDS = ['true', 'totoo', 'accurate', 'correct', 'fact'];

/** Long free-text ratings (full sentences some publishers put in `textualRating`) must never map to `true`
 *  off an incidental word match (e.g. "fact") — only an explicit false/misleading keyword can match them. */
const MAX_SHORT_RATING_LEN = 60;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches `keyword` as a whole word/phrase in `text` — bounded by non-letters or string edges, Unicode-aware
 *  so e.g. "mali" matches standalone but not inside "malinaw". Both args are expected already lowercased. */
function matchesKeyword(text: string, keyword: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}])${escapeRegExp(keyword)}([^\\p{L}]|$)`, 'u');
  return pattern.test(text);
}

/**
 * Case-insensitive keyword map, English + Filipino, matched on word boundaries. Checks false/misleading
 * before true so phrases like "not true" and "half true" don't fall through to the `true` keyword match.
 * A `textualRating` longer than MAX_SHORT_RATING_LEN that doesn't hit a false/misleading keyword is `other`
 * even if it contains a `true` keyword — long free text is never trusted to mean "true".
 */
export function normalizeRating(textualRating: string): 'false' | 'misleading' | 'true' | 'other' {
  const r = textualRating.toLowerCase();
  if (FALSE_KEYWORDS.some((k) => matchesKeyword(r, k))) return 'false';
  if (MISLEADING_KEYWORDS.some((k) => matchesKeyword(r, k))) return 'misleading';
  if (textualRating.length > MAX_SHORT_RATING_LEN) return 'other';
  if (TRUE_KEYWORDS.some((k) => matchesKeyword(r, k))) return 'true';
  return 'other';
}

/** FNV-1a over a UTF-8-ish byte walk (charCodeAt is good enough here), base36. Pure JS, no `crypto`. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** ISO date (yyyy-mm-dd) from an API date string, or undefined if unparsable. */
function toIsoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/**
 * Maps one `claims[]` item + its `claimReview[]` entry to a Debunk, or null when the rating doesn't map to
 * false/misleading/true.
 */
export function toDebunk(claim: ApiClaim, review: ApiClaimReview): Debunk | null {
  const rating = normalizeRating(review.textualRating);
  if (rating === 'other') return null;

  const date = toIsoDate(review.reviewDate) ?? toIsoDate(claim.claimDate) ?? '';
  return {
    id: fnv1a(review.url),
    claim: claim.text,
    rating,
    publisher: review.publisher?.name ?? review.publisher?.site ?? 'unknown',
    date,
    url: review.url,
    summary: review.title ?? review.textualRating,
    lang: review.languageCode,
  };
}
