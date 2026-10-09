// Bundled corpus of PH fact-checks (assets/corpus/) and the matcher built over it, once per app run.
import { loadBundledCorpus } from '../pipeline/corpus';
import { OfflineMatcher } from '../pipeline/matchOffline';
import type { EvidenceSource } from './checkTypes';

let cached: { matcher: OfflineMatcher; builtAt: string } | null = null;

function load() {
  if (!cached) {
    const { debunks, builtAt } = loadBundledCorpus();
    cached = { matcher: new OfflineMatcher(debunks), builtAt };
  }
  return cached;
}

export function getMatcher(): OfflineMatcher {
  return load().matcher;
}

export function corpusInfo(): { count: number; syncedAt: string } {
  const { matcher, builtAt } = load();
  return { count: matcher.size, syncedAt: builtAt };
}

/** Closest saved fact-checks by text overlap alone (no model); the pipeline uses getMatcher().match instead. */
export async function matchCached(claim: string): Promise<EvidenceSource[]> {
  return getMatcher()
    .prefilter(claim)
    .map(({ debunk: d, jaccard }) => ({
      url: d.url,
      publisher: d.publisher,
      domain: d.url.replace(/^[a-z]+:\/\/(?:www\.)?([^/?#]+).*$/i, '$1'),
      title: d.claim,
      tier: 'A' as const,
      kind: 'factcheck' as const,
      snippet: d.summary,
      stance: d.rating === 'true' ? ('supports' as const) : ('contradicts' as const),
      confidence: jaccard,
      date: d.date,
      claimReview: { rating: d.rating, headline: d.claim },
    }));
}
