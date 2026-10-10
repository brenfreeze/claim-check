// Bundled corpus of PH fact-checks (assets/corpus/) plus what manual syncs added on this phone (corpusSync.ts), and
// the matcher built over both. Rebuilt only when a sync lands.
import { loadBundledCorpus, type Debunk } from '../pipeline/corpus';
import { OfflineMatcher } from '../pipeline/matchOffline';
import type { EvidenceSource } from './checkTypes';
import { createStore, useStore } from './store';

type Corpus = { matcher: OfflineMatcher; syncedAt: string };

let bundled: { debunks: Debunk[]; builtAt: string } | null = null;
const corpus = createStore<Corpus | null>(null);

function load(): Corpus {
  let c = corpus.get();
  if (!c) {
    bundled ??= loadBundledCorpus();
    c = { matcher: new OfflineMatcher(bundled.debunks), syncedAt: bundled.builtAt };
    corpus.set(c);
  }
  return c;
}

/** Merges synced fact-checks (deduped by URL against the bundled corpus); returns how many were new. */
export function setSyncedCorpus(synced: Debunk[], syncedAt: string): { added: number } {
  bundled ??= loadBundledCorpus();
  const urls = new Set(bundled.debunks.map((d) => d.url));
  const extra = synced.filter((d) => !urls.has(d.url));
  corpus.set({ matcher: new OfflineMatcher([...extra, ...bundled.debunks]), syncedAt });
  return { added: extra.length };
}

export function getMatcher(): OfflineMatcher {
  return load().matcher;
}

export function corpusInfo(): { count: number; syncedAt: string } {
  const { matcher, syncedAt } = load();
  return { count: matcher.size, syncedAt };
}

/** corpusInfo that re-renders when a sync lands. */
export function useCorpusInfo(): { count: number; syncedAt: string } {
  useStore(corpus);
  return corpusInfo();
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
