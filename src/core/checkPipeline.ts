// Check pipeline: post text → streamed CheckEvents. MOCK: replays the sample claims with realistic timing.
// The engine session replaces the bodies with extract (Decima Noul) → src/pipeline/matchOffline.ts → aggregate,
// and enrichClaim with the live-search judge. Signatures and event order are the contract the UI relies on.
import type { DecisionEngine } from '../engine/types';
import type { CheckEvent, CheckResult, CheckSource, ClaimResult, EngineChoice } from './checkTypes';
import { corpusInfo } from './factcheckCache';
import { seedFor } from './mockData';
import { mockClaimScore, splitSentences, writingSignals } from './text';

export interface RunCheckOptions {
  id: string;
  engine: DecisionEngine;
  engineChoice: EngineChoice;
  gate: number;
  source: CheckSource;
  signal?: AbortSignal;
  /** sentences the user picked on the Scan screen; skips claim detection */
  sentences?: string[];
  /** scales the mock's delays (tests pass 0) */
  speed?: number;
}

const CLAIM_GATE = 0.5;

export async function* runCheck(input: string, opts: RunCheckOptions): AsyncIterable<CheckEvent> {
  const t0 = Date.now();
  const wait = (ms: number) => sleep(ms * (opts.speed ?? 1));
  const aborted = () => opts.signal?.aborted === true;

  yield { type: 'stage', stage: 'extract', status: 'active', summary: 'Splitting the post into sentences' };
  await wait(450);
  if (aborted()) return;
  const sentences = splitSentences(input);
  const claimSentences = opts.sentences ?? sentences.filter((s) => mockClaimScore(s) >= CLAIM_GATE);
  const pending = claimSentences.map((s, i) => ({ id: `${opts.id}-c${i}`, original: s, seed: seedFor(s) }));
  yield {
    type: 'stage',
    stage: 'extract',
    status: 'done',
    summary: `${claimSentences.length} of ${sentences.length} sentences are checkable`,
    meta: `${sentences.length} decisions · ${sentences.length * 19} ms`,
  };
  yield { type: 'pending', claims: pending.map((p) => ({ id: p.id, text: p.seed?.text ?? p.original, sources: 0 })) };

  const corpus = corpusInfo();
  yield {
    type: 'stage',
    stage: 'match',
    status: 'active',
    summary: `Each claim compared with ${corpus.count.toLocaleString('en-US')} saved fact-checks`,
  };
  const claims: ClaimResult[] = [];
  const total = pending.reduce((n, p) => n + (p.seed?.decisions ?? 8), 0);
  let done = 0;
  for (const p of pending) {
    const decisions = p.seed?.decisions ?? 8;
    for (let k = 0; k < decisions; k++) {
      await wait(60);
      if (aborted()) return;
      done++;
      if (k % 3 === 2 || k === decisions - 1) yield { type: 'progress', stage: 'match', done, total, avgMs: 21 };
    }
    const claim = toClaim(p.id, p.original, opts.engineChoice, opts.gate, p.seed);
    claims.push(claim);
    yield { type: 'claim', claim };
  }
  yield { type: 'stage', stage: 'match', status: 'done', summary: `${claims.length} claims matched`, meta: `${total} decisions · avg 21 ms` };

  yield { type: 'stage', stage: 'aggregate', status: 'active', summary: `Anything under ${opts.gate.toFixed(2)} becomes Unverified` };
  await wait(300);
  if (aborted()) return;
  yield { type: 'stage', stage: 'aggregate', status: 'done', summary: `Anything under ${opts.gate.toFixed(2)} became Unverified` };

  const result: CheckResult = {
    id: opts.id,
    input,
    source: opts.source,
    createdAt: new Date().toISOString(),
    sentenceCount: sentences.length,
    gate: opts.gate,
    corpus,
    networkUsed: false,
    claims,
    signals: writingSignals(input),
    stats: { engine: opts.engineChoice, decisions: total + sentences.length, totalMs: Date.now() - t0 },
  };
  yield { type: 'done', result };
}

export interface EnrichOptions {
  engine: DecisionEngine;
  engineChoice: EngineChoice;
  signal?: AbortSignal;
  speed?: number;
}

/** Online enrichment for one claim: live search + judge. Emits 'claim' (running → final), never 'done'. */
export async function* enrichClaim(check: CheckResult, claimId: string, opts: EnrichOptions): AsyncIterable<CheckEvent> {
  const claim = check.claims.find((c) => c.id === claimId);
  if (!claim) {
    yield { type: 'error', message: `Claim ${claimId} not found` };
    return;
  }
  const wait = (ms: number) => sleep(ms * (opts.speed ?? 1));
  yield { type: 'claim', claim: { ...claim, enrichment: { status: 'running', message: 'Finding evidence…' } } };
  yield { type: 'stage', stage: 'retrieve', status: 'active', summary: 'Searching the web and published fact-checks' };
  await wait(900);
  if (opts.signal?.aborted) return;
  yield { type: 'stage', stage: 'retrieve', status: 'done', meta: 'network · 0.9 s' };
  yield { type: 'claim', claim: { ...claim, enrichment: { status: 'running', message: 'Weighing evidence…' } } };
  yield { type: 'stage', stage: 'judge', status: 'active' };
  await wait(700);
  if (opts.signal?.aborted) return;
  yield { type: 'stage', stage: 'judge', status: 'done' };

  const enriched = seedFor(claim.original)?.enriched;
  const next: ClaimResult = enriched
    ? {
        ...claim,
        ...enriched,
        path: 'live-search',
        stats: { ...claim.stats, engine: opts.engineChoice, decisions: enriched.decisions, ms: enriched.ms, rule: '≥1 Tier A/B source' },
        enrichment: { status: 'done' },
      }
    : {
        ...claim,
        path: 'live-search',
        reason: 'No trusted source confirms or denies this yet. Treat it with caution.',
        enrichment: { status: 'done' },
      };
  yield { type: 'claim', claim: next };
}

function toClaim(
  id: string,
  original: string,
  engine: EngineChoice,
  gate: number,
  seed: ReturnType<typeof seedFor>,
): ClaimResult {
  const base = seed
    ? { text: seed.text, path: seed.path, verdict: seed.verdict, confidence: seed.confidence, reason: seed.reason, evidence: seed.evidence }
    : { text: original, path: 'offline-match' as const, verdict: 'unverified' as const, confidence: 0.18, reason: 'No known fact-check', evidence: [] };
  const verdict = base.confidence < gate ? 'unverified' : base.verdict;
  return {
    id,
    original,
    ...base,
    verdict,
    stats: {
      engine,
      decisions: seed?.decisions ?? 8,
      ms: seed?.ms ?? 170,
      rule: 'match ≥ gate on a saved fact-check',
      calibration: 'temperature-scaled',
    },
    enrichment: verdict === 'unverified' ? { status: 'idle' } : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}
