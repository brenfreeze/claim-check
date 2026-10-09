// OfflineMatcher with a fake DecisionEngine: no model, no network. The fake answers by looking up the evidence
// (fact-checked claim or alias) in the state text.
import type { DecisionEngine } from '../../engine/types';
import { loadBundledCorpus, mergeCorpus, type Debunk } from '../corpus';
import { OfflineMatcher, TOP_K } from '../matchOffline';

const debunk = (id: string, claim: string, rating: Debunk['rating'], extra: Partial<Debunk> = {}): Debunk => ({
  id,
  claim,
  rating,
  publisher: 'Rappler',
  date: '2026-07-27',
  url: `https://www.rappler.com/${id}`,
  summary: `${claim} is ${rating}`,
  ...extra,
});

const CORPUS: Debunk[] = [
  debunk('suspension', 'Malacañang declared class suspensions nationwide on July 27 for the SONA', 'false'),
  debunk('signal', 'Super Typhoon Enteng is now Signal No. 4 in Metro Manila', 'misleading', {
    aliases: ['Signal No. 4 na raw sa NCR dahil kay Enteng'],
  }),
  debunk('rice', 'The government lowered the price of rice to 20 pesos per kilo in Visayas', 'true'),
];

type Probs = { supports: number; contradicts: number; unrelated: number };
const UNRELATED: Probs = { supports: 0.05, contradicts: 0.05, unrelated: 0.9 };

function fakeEngine(byEvidence: Record<string, Probs>): DecisionEngine & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'decima-local',
    calls,
    systemOne: (async (state: string) => {
      calls.push(state);
      const evidence = state.split('\nEvidence: ')[1];
      const probabilities = byEvidence[evidence] ?? UNRELATED;
      const choice = (Object.keys(probabilities) as (keyof Probs)[]).reduce((a, b) => (probabilities[a] >= probabilities[b] ? a : b));
      return { verdict: { type: 'choice', choice, confidence: 0, probabilities } };
    }) as DecisionEngine['systemOne'],
  };
}

const matcher = new OfflineMatcher(CORPUS);

test('exact claim match on a false fact-check → contradicted with the debunk attached', async () => {
  const engine = fakeEngine({ [CORPUS[0].claim]: { supports: 0.92, contradicts: 0.03, unrelated: 0.05 } });
  const m = await matcher.match(CORPUS[0].claim, engine, 0.7);
  expect(m.verdict).toBe('contradicted');
  expect(m.debunk?.id).toBe('suspension');
  expect(m.confidence).toBeCloseTo(0.92);
  expect(engine.calls[0]).toBe(`Claim: ${CORPUS[0].claim}\nEvidence: ${CORPUS[0].claim}`);
});

test('alias match: a Taglish post close only to an alias is judged against that alias', async () => {
  const alias = CORPUS[1].aliases![0];
  const engine = fakeEngine({ [alias]: { supports: 0.81, contradicts: 0.04, unrelated: 0.15 } });
  const post = 'SIGNAL NO. 4 NA RAW SA NCR dahil kay Enteng!!';
  expect(matcher.prefilter(post)[0]).toMatchObject({ text: alias });
  const m = await matcher.match(post, engine, 0.7);
  expect(m.verdict).toBe('contradicted');
  expect(m.debunk?.id).toBe('signal');
});

test('best p(supports) below the gate → unverified, "No known fact-check", no debunk', async () => {
  const engine = fakeEngine({ [CORPUS[0].claim]: { supports: 0.6, contradicts: 0.1, unrelated: 0.3 } });
  const m = await matcher.match(CORPUS[0].claim, engine, 0.7);
  expect(m).toMatchObject({ verdict: 'unverified', reason: 'No known fact-check', confidence: 0.6 });
  expect(m.debunk).toBeUndefined();
});

test('a fact-check rated true → supported', async () => {
  const engine = fakeEngine({ [CORPUS[2].claim]: { supports: 0.88, contradicts: 0.02, unrelated: 0.1 } });
  const m = await matcher.match('The government lowered rice to 20 pesos per kilo in the Visayas', engine, 0.7);
  expect(m.verdict).toBe('supported');
  expect(m.debunk?.id).toBe('rice');
});

test('post asserts the opposite (contradicts ≥ gate) → unverified with the debunk attached', async () => {
  const engine = fakeEngine({ [CORPUS[0].claim]: { supports: 0.05, contradicts: 0.85, unrelated: 0.1 } });
  const m = await matcher.match('Malacañang did not declare class suspensions on July 27', engine, 0.7);
  expect(m).toMatchObject({ verdict: 'unverified', reason: 'Related fact-check found (post says the opposite)', opposite: true });
  expect(m.debunk?.id).toBe('suspension');
});

test('prefilter returns at most TOP_K ranked by Jaccard; no overlap → no engine calls', async () => {
  const many = Array.from({ length: 20 }, (_, i) => debunk(`d${i}`, `class suspension rumor number ${i} in Manila`, 'false'));
  const big = new OfflineMatcher(many);
  const top = big.prefilter('class suspension rumor in Manila');
  expect(top).toHaveLength(TOP_K);
  for (let i = 1; i < top.length; i++) expect(top[i - 1].jaccard).toBeGreaterThanOrEqual(top[i].jaccard);

  const engine = fakeEngine({});
  const m = await matcher.match('zzzz qqqq', engine, 0.7);
  expect(engine.calls).toHaveLength(0);
  expect(m).toMatchObject({ verdict: 'unverified', decisions: 0, confidence: 0 });
});

test('mergeCorpus appends aliases, overrides fields, ignores unknown ids', () => {
  const merged = mergeCorpus(CORPUS, [
    { id: 'signal', aliases: ['Enteng signal 4 na'], summary: 'edited' },
    { id: 'REPLACE_ME_1', aliases: ['x'] },
  ]);
  expect(merged).toHaveLength(CORPUS.length);
  expect(merged[1].aliases).toEqual(['Signal No. 4 na raw sa NCR dahil kay Enteng', 'Enteng signal 4 na']);
  expect(merged[1].summary).toBe('edited');
  expect(merged[0]).toBe(CORPUS[0]);
});

test('loadBundledCorpus returns entries and an ISO build date', () => {
  const { debunks, builtAt } = loadBundledCorpus();
  expect(debunks.length).toBeGreaterThan(0);
  expect(new Date(builtAt).toISOString()).toBe(builtAt);
});
