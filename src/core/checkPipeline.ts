// Check pipeline: post text → streamed CheckEvents. Default path is fully on-device: claim sentences → the offline
// matcher (src/pipeline/matchOffline.ts) against the bundled corpus → results. enrichClaim is the opt-in online
// step: a live fact-check search for one claim, judged with the same matcher. Event order is the UI's contract.
import type { DecisionEngine } from '../engine/types';
import type { Debunk } from '../pipeline/corpus';
import { OfflineMatcher, type OfflineMatch } from '../pipeline/matchOffline';
import type { CheckEvent, CheckResult, CheckSource, ClaimResult, EngineChoice, EvidenceSource } from './checkTypes';
import { factcheckKey, searchFactchecks } from './enrich';
import { corpusInfo, getMatcher } from './factcheckCache';
import { beginOfflineSection } from './netGuard';
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
  /** corpus to match against; defaults to the bundled one (tests inject a small one) */
  matcher?: OfflineMatcher;
  /** unused since the mock went away; kept so existing callers still type-check */
  speed?: number;
}

const CLAIM_GATE = 0.5;
const MATCH_RULE = 'match ≥ gate on a saved fact-check';

export async function* runCheck(input: string, opts: RunCheckOptions): AsyncIterable<CheckEvent> {
  const t0 = Date.now();
  const endGuard = beginOfflineSection('offline check');
  const aborted = () => opts.signal?.aborted === true;
  try {
    yield { type: 'stage', stage: 'extract', status: 'active', summary: 'Splitting the post into sentences' };
    const sentences = splitSentences(input);
    const claimSentences = opts.sentences ?? sentences.filter((s) => mockClaimScore(s) >= CLAIM_GATE);
    const pending = claimSentences.map((s, i) => ({ id: `${opts.id}-c${i}`, text: s }));
    yield {
      type: 'stage',
      stage: 'extract',
      status: 'done',
      summary: `${claimSentences.length} of ${sentences.length} sentences are checkable`,
      meta: `${sentences.length} sentences · on-device`,
    };
    yield { type: 'pending', claims: pending.map((p) => ({ id: p.id, text: p.text, sources: 0 })) };
    if (aborted()) return;

    const matcher = opts.matcher ?? getMatcher();
    const corpus = opts.matcher ? { count: matcher.size, syncedAt: corpusInfo().syncedAt } : corpusInfo();
    yield {
      type: 'stage',
      stage: 'match',
      status: 'active',
      summary: `Each claim compared with ${corpus.count.toLocaleString('en-US')} saved fact-checks`,
    };
    const total = pending.reduce((n, p) => n + matcher.prefilter(p.text).length, 0);
    const claims: ClaimResult[] = [];
    let done = 0;
    let matchMs = 0;
    for (const p of pending) {
      const m = await matcher.match(p.text, opts.engine, opts.gate, opts.signal, () => done++);
      if (aborted()) return;
      matchMs += m.ms;
      yield { type: 'progress', stage: 'match', done, total: Math.max(total, done), avgMs: done ? Math.round(matchMs / done) : 0 };
      const claim = toClaim(p.id, p.text, m, opts.engineChoice, 'offline-match');
      claims.push(claim);
      yield { type: 'claim', claim };
    }
    const matched = claims.filter((c) => c.evidence.some((e) => e.kind === 'factcheck')).length;
    yield {
      type: 'stage',
      stage: 'match',
      status: 'done',
      summary: `${matched} of ${claims.length} claims have a saved fact-check`,
      meta: `${done} decisions · avg ${done ? Math.round(matchMs / done) : 0} ms`,
    };

    yield { type: 'stage', stage: 'aggregate', status: 'active', summary: `Anything under ${opts.gate.toFixed(2)} becomes Unverified` };
    yield { type: 'stage', stage: 'aggregate', status: 'done', summary: `Anything under ${opts.gate.toFixed(2)} became Unverified` };

    const result: CheckResult = {
      id: opts.id,
      input,
      source: opts.source,
      createdAt: new Date().toISOString(),
      sentenceCount: sentences.length,
      gate: opts.gate,
      corpus,
      networkUsed: endGuard().length > 0,
      claims,
      signals: writingSignals(input),
      stats: { engine: opts.engineChoice, decisions: done, totalMs: Date.now() - t0 },
    };
    yield { type: 'done', result };
  } finally {
    endGuard();
  }
}

export interface EnrichOptions {
  engine: DecisionEngine;
  engineChoice: EngineChoice;
  signal?: AbortSignal;
  /** fact-check search; defaults to the live Google Fact Check Tools API (tests inject a fake) */
  search?: (query: string, signal?: AbortSignal) => Promise<Debunk[]>;
  speed?: number;
}

/** Online enrichment for one claim: live fact-check search + judge. Emits 'claim' (running → final), never 'done'. */
export async function* enrichClaim(check: CheckResult, claimId: string, opts: EnrichOptions): AsyncIterable<CheckEvent> {
  const claim = check.claims.find((c) => c.id === claimId);
  if (!claim) {
    yield { type: 'error', message: `Claim ${claimId} not found` };
    return;
  }
  const key = factcheckKey();
  const search = opts.search ?? (key ? (q: string, s?: AbortSignal) => searchFactchecks(q, key, s) : undefined);
  if (!search) {
    yield { type: 'claim', claim: { ...claim, enrichment: { status: 'failed', message: 'No fact-check search key configured' } } };
    return;
  }

  yield { type: 'claim', claim: { ...claim, enrichment: { status: 'running', message: 'Searching published fact-checks…' } } };
  yield { type: 'stage', stage: 'retrieve', status: 'active', summary: 'Searching published fact-checks online' };
  const t0 = Date.now();
  let found: Debunk[];
  try {
    found = await search(claim.text, opts.signal);
  } catch (e) {
    if (opts.signal?.aborted) return;
    const message = e instanceof Error && /\(\d+\)/.test(e.message) ? e.message : 'Could not reach the fact-check search';
    yield { type: 'claim', claim: { ...claim, enrichment: { status: 'failed', message } } };
    return;
  }
  if (opts.signal?.aborted) return;
  yield { type: 'stage', stage: 'retrieve', status: 'done', meta: `network · ${found.length} results · ${((Date.now() - t0) / 1000).toFixed(1)} s` };

  yield { type: 'claim', claim: { ...claim, enrichment: { status: 'running', message: 'Weighing evidence…' } } };
  yield { type: 'stage', stage: 'judge', status: 'active' };
  const m = await new OfflineMatcher(found).match(claim.text, opts.engine, check.gate, opts.signal);
  if (opts.signal?.aborted) return;
  yield { type: 'stage', stage: 'judge', status: 'done' };

  const next = toClaim(claim.id, claim.original, m, opts.engineChoice, 'live-search');
  yield {
    type: 'claim',
    claim: {
      ...next,
      text: claim.text,
      reason: m.debunk ? next.reason : 'No published fact-check found online either',
      enrichment: { status: 'done' },
    },
  };
}

function toClaim(id: string, text: string, m: OfflineMatch, engine: EngineChoice, path: ClaimResult['path']): ClaimResult {
  return {
    id,
    text,
    original: text,
    path,
    verdict: m.verdict,
    confidence: m.confidence,
    reason: m.reason,
    evidence: m.debunk ? [toEvidence(m.debunk, m.confidence)] : [],
    stats: { engine, decisions: m.decisions, ms: m.ms, rule: MATCH_RULE, calibration: 'temperature-scaled' },
    enrichment: m.verdict === 'unverified' && path === 'offline-match' ? { status: 'idle' } : undefined,
  };
}

function toEvidence(d: Debunk, confidence: number): EvidenceSource {
  return {
    url: d.url,
    publisher: d.publisher,
    domain: host(d.url),
    title: d.claim,
    tier: 'A',
    kind: 'factcheck',
    snippet: d.summary,
    stance: d.rating === 'true' ? 'supports' : 'contradicts',
    confidence,
    date: d.date,
    claimReview: { rating: d.rating, headline: d.claim },
  };
}

function host(url: string): string {
  const m = /^[a-z]+:\/\/(?:www\.)?([^/?#]+)/i.exec(url);
  return m ? m[1] : url;
}
