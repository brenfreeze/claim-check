// "Has this already been fact-checked?" answered on-device: trigram prefilter over the bundled corpus, then one
// Decima decision per candidate in ft3's trained framing (the fact-checked claim is the evidence).
import type { DecisionEngine } from '../engine/types';
import type { Debunk } from './corpus';

export const TOP_K = 8;
export const MATCH_QUESTION = {
  kind: 'choice',
  instructions: 'Does the evidence support the claim?',
  criteria: { supports: '', contradicts: '', unrelated: '' },
} as const;

export type OfflineVerdict = 'supported' | 'contradicted' | 'unverified';
type Stance = 'supports' | 'contradicts' | 'unrelated';

export interface MatchCandidate {
  debunk: Debunk;
  /** the claim or alias that scored best */
  text: string;
  jaccard: number;
  probs?: Record<Stance, number>;
}

export interface OfflineMatch {
  verdict: OfflineVerdict;
  confidence: number;
  reason: string;
  debunk?: Debunk;
  candidates: MatchCandidate[];
  decisions: number;
  ms: number;
}

export const trigrams = (s: string) => {
  const t = ` ${s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '')} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
};

export const jaccard = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n || 1);
};

export class OfflineMatcher {
  private readonly index: { debunk: Debunk; texts: { text: string; grams: Set<string> }[] }[];

  constructor(debunks: Debunk[]) {
    this.index = debunks.map((debunk) => ({
      debunk,
      texts: [debunk.claim, ...(debunk.aliases ?? [])].map((text) => ({ text, grams: trigrams(text) })),
    }));
  }

  get size(): number {
    return this.index.length;
  }

  /** Best Jaccard per debunk over its claim and aliases; top k with any overlap, ties → newer fact-check. */
  prefilter(claim: string, k = TOP_K): MatchCandidate[] {
    const grams = trigrams(claim);
    const scored: MatchCandidate[] = [];
    for (const { debunk, texts } of this.index) {
      let best = { text: debunk.claim, jaccard: 0 };
      for (const t of texts) {
        const j = jaccard(grams, t.grams);
        if (j > best.jaccard) best = { text: t.text, jaccard: j };
      }
      if (best.jaccard > 0) scored.push({ debunk, ...best });
    }
    scored.sort((a, b) => b.jaccard - a.jaccard || b.debunk.date.localeCompare(a.debunk.date));
    return scored.slice(0, k);
  }

  async match(
    claim: string,
    engine: DecisionEngine,
    gate: number,
    signal?: AbortSignal,
    onDecision?: () => void,
  ): Promise<OfflineMatch> {
    const t0 = Date.now();
    const candidates = this.prefilter(claim);
    let decisions = 0;
    for (const c of candidates) {
      if (signal?.aborted) break;
      const { verdict } = await engine.systemOne(`Claim: ${claim}\nEvidence: ${c.text}`, { verdict: MATCH_QUESTION });
      const p = verdict.probabilities;
      c.probs = { supports: p.supports ?? 0, contradicts: p.contradicts ?? 0, unrelated: p.unrelated ?? 0 };
      decisions++;
      onDecision?.();
    }
    const judged = candidates.filter((c) => c.probs);
    const ms = Date.now() - t0;
    const base = { candidates, decisions, ms };

    const best = judged.reduce<MatchCandidate | undefined>((a, c) => (!a || c.probs!.supports > a.probs!.supports ? c : a), undefined);
    if (best && best.probs!.supports >= gate) {
      const { debunk } = best;
      return {
        ...base,
        verdict: debunk.rating === 'true' ? 'supported' : 'contradicted',
        confidence: best.probs!.supports,
        reason: `Matches a ${debunk.publisher} fact-check rated ${debunk.rating}`,
        debunk,
      };
    }

    // No "post says the opposite" result: on Tagalog pairs ft3 answers contradicts ≈ 1.0 for unrelated fact-checks
    // (src/pipeline/__tests__/demoPosts.eval.ts), so attaching them as "related" would mislead.
    return { ...base, verdict: 'unverified', confidence: best?.probs!.supports ?? 0, reason: 'No known fact-check' };
  }
}
