import { runCheck, enrichClaim } from '../../core/checkPipeline';
import type { CheckEvent } from '../../core/checkTypes';
import type { DecisionEngine } from '../../engine/types';
import type { Debunk } from '../../pipeline/corpus';
import { OfflineMatcher } from '../../pipeline/matchOffline';
import { SAMPLE_POST } from './samplePost';
import { initialCheck, reduceCheck, stillPending, type CheckState } from '../checkReducer';

// A small corpus and a fake engine stand in for the bundled corpus and Decima: the engine "supports" a fact-checked
// claim only for posts containing its key word in SUPPORTS, with the given probability.
const fc = (id: string, claim: string, rating: Debunk['rating']): Debunk => ({
  id, claim, rating, publisher: 'Rappler', date: '2026-08-01', url: `https://www.rappler.com/${id}`, summary: `${rating}: ${claim}`,
});
const CORPUS = [
  fc('signal', 'PAGASA raised Signal No. 4 over Metro Manila tonight', 'false'),
  fc('pasok', 'Walang pasok sa lahat ng public schools sa NCR bukas', 'false'),
  fc('salabat', 'Salabat na may kalamansi prevents dengue', 'misleading'),
  fc('meralco', 'Meralco is giving a 500 peso rebate this month', 'true'),
];
const SUPPORTS: Record<string, [string, number]> = {
  [CORPUS[0].claim]: ['Signal', 0.91],
  [CORPUS[1].claim]: ['pasok', 0.88],
  [CORPUS[2].claim]: ['salabat', 0.8],
};

const engine = {
  id: 'decima-local',
  systemOne: async (state: string) => {
    const [post, evidence] = state.replace(/^Claim: /, '').split('\nEvidence: ');
    const rule = SUPPORTS[evidence];
    const p = rule && post.includes(rule[0]) ? rule[1] : 0;
    const probabilities = p ? { supports: p, contradicts: (1 - p) / 2, unrelated: (1 - p) / 2 } : { supports: 0.05, contradicts: 0.05, unrelated: 0.9 };
    return { verdict: { type: 'choice', choice: '', confidence: 0, probabilities } };
  },
} as unknown as DecisionEngine;
const matcher = new OfflineMatcher(CORPUS);
const opts = { id: 'k1', engine, engineChoice: 'decima-local' as const, gate: 0.7, source: 'paste' as const, matcher };

async function collect(it: AsyncIterable<CheckEvent>): Promise<CheckEvent[]> {
  const out: CheckEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

const fresh = () => initialCheck({ id: 'k1', input: SAMPLE_POST, source: 'paste', engine: 'decima-local', gate: 0.7 });

describe('reduceCheck', () => {
  test('a full run ends done with four claims, every step done, no network', async () => {
    const s = (await collect(runCheck(SAMPLE_POST, opts))).reduce(reduceCheck, fresh());
    expect(s.status).toBe('done');
    expect(s.claims).toHaveLength(4);
    expect(Object.values(s.steps).every((st) => st.status === 'done')).toBe(true);
    expect(s.result?.networkUsed).toBe(false);
    expect(s.result?.corpus.count).toBe(CORPUS.length);
    expect(stillPending(s)).toEqual([]);
    expect(s.claims.map((c) => c.verdict)).toEqual(['contradicted', 'contradicted', 'contradicted', 'unverified']);
    expect(s.claims[0].evidence[0]).toMatchObject({ kind: 'factcheck', tier: 'A', domain: 'rappler.com', claimReview: { rating: 'false' } });
    expect(s.claims[3]).toMatchObject({ reason: 'No known fact-check', evidence: [], enrichment: { status: 'idle' } });
  });

  test('mid-run, claims without a result are still pending', async () => {
    const events = await collect(runCheck(SAMPLE_POST, opts));
    const firstClaim = events.findIndex((e) => e.type === 'claim');
    const s = events.slice(0, firstClaim + 1).reduce(reduceCheck, fresh());
    expect(s.status).toBe('running');
    expect(s.steps.extract.status).toBe('done');
    expect(s.steps.match.status).toBe('active');
    expect(stillPending(s)).toHaveLength(3);
  });

  test('error and cancel', () => {
    expect(reduceCheck(fresh(), { type: 'error', message: 'boom' })).toMatchObject({ status: 'error', error: 'boom' });
    expect(reduceCheck(fresh(), { type: 'cancel' }).status).toBe('cancelled');
    const done: CheckState = { ...fresh(), status: 'done' };
    expect(reduceCheck(done, { type: 'cancel' }).status).toBe('done');
  });

  test('a raised gate turns a lower-confidence match Unverified', async () => {
    const s = (await collect(runCheck(SAMPLE_POST, { ...opts, gate: 0.85 }))).reduce(reduceCheck, fresh());
    // 0.91 and 0.88 stay contradicted, 0.80 (salabat) drops under 0.85
    expect(s.claims.map((c) => c.verdict)).toEqual(['contradicted', 'contradicted', 'unverified', 'unverified']);
  });

  test('enrichment queues offline, then replaces the claim from a live search and marks network used', async () => {
    let s = (await collect(runCheck(SAMPLE_POST, opts))).reduce(reduceCheck, fresh());
    const target = s.claims[3];
    expect(target.enrichment?.status).toBe('idle');

    s = reduceCheck(s, { type: 'enrich-queued', claimId: target.id });
    expect(s.claims[3].enrichment?.status).toBe('queued');

    SUPPORTS[CORPUS[3].claim] = ['Meralco', 0.9];
    const search = async () => [CORPUS[3]];
    const enriched = await collect(enrichClaim(s.result!, target.id, { engine, engineChoice: 'decima-local', search }));
    delete SUPPORTS[CORPUS[3].claim];
    s = enriched.reduce(reduceCheck, s);
    expect(s.claims[3]).toMatchObject({ path: 'live-search', verdict: 'supported', enrichment: { status: 'done' } });
    expect(s.result?.claims[3].verdict).toBe('supported');
    expect(s.result?.networkUsed).toBe(true);
    // enrichment stages never touch the pipeline stepper
    expect(s.steps.match.status).toBe('done');
  });

  test('enrichment without a search key fails with a short message', async () => {
    const s = (await collect(runCheck(SAMPLE_POST, opts))).reduce(reduceCheck, fresh());
    const prev = process.env.EXPO_PUBLIC_FACTCHECK_API_KEY;
    delete process.env.EXPO_PUBLIC_FACTCHECK_API_KEY;
    const events = await collect(enrichClaim(s.result!, s.claims[3].id, { engine, engineChoice: 'decima-local' }));
    if (prev !== undefined) process.env.EXPO_PUBLIC_FACTCHECK_API_KEY = prev;
    expect(events).toEqual([
      { type: 'claim', claim: expect.objectContaining({ enrichment: { status: 'failed', message: 'No fact-check search key configured' } }) },
    ]);
  });
});

describe('runCheck event order', () => {
  test('stages open before they close, claims come before done, done is last', async () => {
    const events = await collect(runCheck(SAMPLE_POST, opts));
    const open = new Set<string>();
    for (const e of events) {
      if (e.type === 'stage' && e.status === 'active') open.add(e.stage);
      if (e.type === 'stage' && e.status === 'done') expect(open.has(e.stage)).toBe(true);
    }
    expect(events[events.length - 1].type).toBe('done');
    const lastClaim = events.map((e) => e.type).lastIndexOf('claim');
    expect(lastClaim).toBeLessThan(events.length - 1);
    expect(events.findIndex((e) => e.type === 'pending')).toBeLessThan(events.findIndex((e) => e.type === 'claim'));
  });

  test('stops emitting after abort', async () => {
    const ctrl = new AbortController();
    const out: CheckEvent[] = [];
    for await (const e of runCheck(SAMPLE_POST, { ...opts, signal: ctrl.signal })) {
      out.push(e);
      if (e.type === 'pending') ctrl.abort();
    }
    expect(out.some((e) => e.type === 'claim' || e.type === 'done')).toBe(false);
  });

  test('picked sentences from Scan skip claim detection', async () => {
    const picked = 'May ₱500 rebate daw from Meralco ngayong buwan.';
    const events = await collect(runCheck(SAMPLE_POST, { ...opts, source: 'screenshot', sentences: [picked] }));
    const done = events.find((e) => e.type === 'done');
    expect(done?.type === 'done' && done.result.claims.map((c) => c.text)).toEqual([picked]);
  });

  test('a fetch during an offline check is caught by the network guard', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}')) as typeof fetch;
    const noisy = { ...engine, systemOne: async (s: string, q: never) => (await fetch('https://example.com/leak'), engine.systemOne(s, q)) } as DecisionEngine;
    const warn = jest.spyOn(console, 'log').mockImplementation(() => {});
    const events = await collect(runCheck(SAMPLE_POST, { ...opts, engine: noisy }));
    warn.mockRestore();
    globalThis.fetch = realFetch;
    const done = events.find((e) => e.type === 'done');
    expect(done?.type === 'done' && done.result.networkUsed).toBe(true);
  });
});
