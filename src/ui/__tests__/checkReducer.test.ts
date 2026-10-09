import { runCheck, enrichClaim } from '../../core/checkPipeline';
import type { CheckEvent } from '../../core/checkTypes';
import type { DecisionEngine } from '../../engine/types';
import { SAMPLE_POST } from '../../core/mockData';
import { initialCheck, reduceCheck, stillPending, type CheckState } from '../checkReducer';

const engine = { id: 'decima-local', systemOne: async () => ({}) } as unknown as DecisionEngine;

async function collect(it: AsyncIterable<CheckEvent>): Promise<CheckEvent[]> {
  const out: CheckEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

const fresh = () => initialCheck({ id: 'k1', input: SAMPLE_POST, source: 'paste', engine: 'decima-local', gate: 0.7 });

describe('reduceCheck', () => {
  test('a full mock run ends done with four claims and every step done', async () => {
    const events = await collect(runCheck(SAMPLE_POST, { id: 'k1', engine, engineChoice: 'decima-local', gate: 0.7, source: 'paste', speed: 0 }));
    const s = events.reduce(reduceCheck, fresh());
    expect(s.status).toBe('done');
    expect(s.claims).toHaveLength(4);
    expect(Object.values(s.steps).every((st) => st.status === 'done')).toBe(true);
    expect(s.result?.networkUsed).toBe(false);
    expect(stillPending(s)).toEqual([]);
    expect(s.claims.map((c) => c.verdict)).toEqual(['contradicted', 'unverified', 'contradicted', 'unverified']);
  });

  test('mid-run, claims without a result are still pending', async () => {
    const events = await collect(runCheck(SAMPLE_POST, { id: 'k1', engine, engineChoice: 'decima-local', gate: 0.7, source: 'paste', speed: 0 }));
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

  test('a raised gate turns a low-confidence match Unverified', async () => {
    const events = await collect(runCheck(SAMPLE_POST, { id: 'k1', engine, engineChoice: 'decima-local', gate: 0.9, source: 'paste', speed: 0 }));
    const s = events.reduce(reduceCheck, fresh());
    // 0.91 stays contradicted, 0.87 (salabat) drops under 0.90
    expect(s.claims.map((c) => c.verdict)).toEqual(['contradicted', 'unverified', 'unverified', 'unverified']);
  });

  test('enrichment queues offline, then replaces the claim and marks network used', async () => {
    const events = await collect(runCheck(SAMPLE_POST, { id: 'k1', engine, engineChoice: 'decima-local', gate: 0.7, source: 'paste', speed: 0 }));
    let s = events.reduce(reduceCheck, fresh());
    const target = s.claims[1];
    expect(target.enrichment?.status).toBe('idle');

    s = reduceCheck(s, { type: 'enrich-queued', claimId: target.id });
    expect(s.claims[1].enrichment?.status).toBe('queued');

    const enriched = await collect(enrichClaim(s.result!, target.id, { engine, engineChoice: 'decima-local', speed: 0 }));
    s = enriched.reduce(reduceCheck, s);
    expect(s.claims[1]).toMatchObject({ path: 'live-search', verdict: 'supported', enrichment: { status: 'done' } });
    expect(s.result?.claims[1].verdict).toBe('supported');
    expect(s.result?.networkUsed).toBe(true);
    // enrichment stages never touch the pipeline stepper
    expect(s.steps.match.status).toBe('done');
  });
});

describe('runCheck (mock) event order', () => {
  test('stages open before they close, claims come before done, done is last', async () => {
    const events = await collect(runCheck(SAMPLE_POST, { id: 'k1', engine, engineChoice: 'decima-local', gate: 0.7, source: 'paste', speed: 0 }));
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
    for await (const e of runCheck(SAMPLE_POST, { id: 'k1', engine, engineChoice: 'decima-local', gate: 0.7, source: 'paste', speed: 0.01, signal: ctrl.signal })) {
      out.push(e);
      if (e.type === 'pending') ctrl.abort();
    }
    expect(out.some((e) => e.type === 'claim' || e.type === 'done')).toBe(false);
  });

  test('picked sentences from Scan skip claim detection', async () => {
    const events = await collect(
      runCheck(SAMPLE_POST, { id: 'k1', engine, engineChoice: 'decima-local', gate: 0.7, source: 'screenshot', speed: 0, sentences: ['May ₱500 rebate daw from Meralco ngayong buwan.'] }),
    );
    const done = events.find((e) => e.type === 'done');
    expect(done?.type === 'done' && done.result.claims.map((c) => c.text)).toEqual(['Meralco is giving a ₱500 rebate this month.']);
  });
});
