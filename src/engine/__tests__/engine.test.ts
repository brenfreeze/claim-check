/**
 * @jest-environment ./jest.ort-env.js
 */
// End to end on Node: OnDeviceDecimaEngine with onnxruntime-node (same onnxruntime-common API as the React
// Native binding) against the Python reference. SP-04, SP-05, SP-06 and the SP-10 interface.
import * as ort from 'onnxruntime-node';
import { OnDeviceDecimaEngine } from '../OnDeviceDecimaEngine';
import type { DecisionEngine, Question } from '../types';
import { allRuns, MODEL_DIR, modelPresent, readText, reference } from './reference';

const PARITY_TOL = 0.02; // SP-05 target; the Node run is expected to be far tighter
const d = modelPresent ? describe : describe.skip;

d('OnDeviceDecimaEngine on onnxruntime-node', () => {
  let engine: OnDeviceDecimaEngine;
  const maxDelta: Record<string, number> = {};

  beforeAll(async () => {
    engine = await OnDeviceDecimaEngine.load({ ort, modelDir: MODEL_DIR, readText, sessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
  });

  afterAll(() => {
    const worst = Math.max(...Object.values(maxDelta));
    console.log(`max |Δp| vs Python over ${Object.keys(maxDelta).length} runs: ${worst.toExponential(2)}`);
  });

  test('load reports timings and the graph inputs/outputs (SP-02)', () => {
    expect(engine.loadTimings.totalMs).toBeGreaterThan(0);
    expect(engine.graphInfo.encoder.inputNames).toEqual(['input_ids', 'attention_mask']);
    expect(engine.graphInfo.scorer.outputNames).toEqual(['scores', 'z']);
  });

  describe('decide(): one probability per option, sums to 1, within 0.02 of Python (SP-04, SP-05)', () => {
    test.each(allRuns)('$name', async ({ name, run }) => {
      const dec = await engine.decide(stateOf(name), { text: reference.question, choices: run.options, kind: 'choose' });
      expect(dec.choices).toEqual(run.options);
      expect(dec.probs).toHaveLength(run.options.length);
      expect(dec.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      const delta = Math.max(...dec.probs.map((p, i) => Math.abs(p - run.probs[i])));
      maxDelta[name] = delta;
      expect(delta).toBeLessThanOrEqual(PARITY_TOL);
    });
  });

  describe('order invariance: same answer under all three option orders (SP-06)', () => {
    test.each(reference.items.map((it) => ({ name: it.id, item: it })))('$name', async ({ item }) => {
      const answers = new Set<string>();
      for (const run of Object.values(item.runs)) {
        const dec = await engine.decide(item.state, { text: reference.question, choices: run.options, kind: 'choose' });
        answers.add(run.options[dec.probs.indexOf(Math.max(...dec.probs))]);
      }
      expect(answers.size).toBe(1);
    });
  });

  test('systemOne(): Choice answers match Python system_one on every fixture (SP-10)', async () => {
    const asEngine: DecisionEngine = engine;
    for (const item of reference.items) {
      const questions = { verdict: choiceQuestion() };
      const got = await asEngine.systemOne(item.state, questions);
      expectAnswersClose(got, item.systemOne);
    }
  });

  test('systemOne(): noul and score smoke answers match Python', async () => {
    for (const smoke of reference.systemOneSmoke) {
      const q = smoke.questions;
      const questions = {
        verdict: choiceQuestion(),
        credible: { kind: 'noul', instructions: q.credible.instructions } as const,
        strength: { kind: 'score', instructions: q.strength.instructions, levels: q.strength.criteria as string[] } as const,
      };
      expectAnswersClose(await engine.systemOne(smoke.state, questions), smoke.answers);
    }
  });

  test('choice encodings are cached per (question, options)', async () => {
    const q = { text: reference.question, choices: ['supports', 'contradicts', 'unrelated'], kind: 'choose' as const };
    await engine.decide(reference.items[0].state, q);
    const second = await engine.decide(reference.items[1].state, q);
    expect(second.timings.encodeChoicesMs).toBe(0);
  });
});

test('release() frees both sessions; a released engine rejects decide()', async () => {
  if (!modelPresent) return;
  const e = await OnDeviceDecimaEngine.load({ ort, modelDir: MODEL_DIR, readText });
  await e.release();
  await expect(e.decide('x', { text: 'q?', choices: ['a', 'b'], kind: 'choose' })).rejects.toThrow();
});

function stateOf(runName: string): string {
  return reference.items.find((it) => runName.startsWith(it.id + '/'))!.state;
}

function choiceQuestion(): Question & { kind: 'choice' } {
  return { kind: 'choice', instructions: reference.question, criteria: Object.fromEntries(reference.options.map((o) => [o, ''])) };
}

/** Same keys and strings; numbers within 2e-4 (Python rounds to 4 decimals, ORT builds differ in the last bits). */
function expectAnswersClose(got: unknown, want: unknown): void {
  if (typeof want === 'number') {
    expect(typeof got).toBe('number');
    expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(2e-4);
  } else if (want && typeof want === 'object') {
    expect(Object.keys(got as object)).toEqual(Object.keys(want));
    for (const k of Object.keys(want)) expectAnswersClose((got as any)[k], (want as any)[k]);
  } else {
    expect(got).toEqual(want);
  }
}
