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
    expect(engine.loadTimings.sessionWaitMs).toBeGreaterThanOrEqual(0);
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

test('load() starts both session creations before the tokenizer files are read', async () => {
  const events: string[] = [];
  const fakeSession = { inputNames: [], outputNames: [], run: async () => ({}), release: async () => {} };
  const fakeOrt = {
    Tensor: ort.Tensor,
    InferenceSession: {
      create: async (p: string) => {
        events.push(`create:${p.split('/').pop()}`);
        await new Promise((r) => setTimeout(r, 20));
        events.push(`created:${p.split('/').pop()}`);
        return fakeSession as never;
      },
    },
  };
  const realRead = readText;
  const fakeRead = async (p: string) => {
    events.push(`read:${p.split('/').pop()}`);
    return realRead(p);
  };
  if (!modelPresent) return;
  const e = await OnDeviceDecimaEngine.load({ ort: fakeOrt, modelDir: MODEL_DIR, readText: fakeRead });
  const firstRead = events.findIndex((x) => x.startsWith('read:'));
  expect(events.indexOf('create:encoder.onnx')).toBeLessThan(firstRead);
  expect(events.indexOf('create:scorer.onnx')).toBeLessThan(firstRead);
  const t = e.loadTimings;
  expect(t.totalMs).toBeGreaterThanOrEqual(Math.max(t.readFilesMs, t.tokenizerMs, t.encoderMs, t.scorerMs));
});

test('load() rejects when a session fails to create', async () => {
  if (!modelPresent) return;
  const failing = { Tensor: ort.Tensor, InferenceSession: { create: async () => { throw new Error('boom'); } } };
  await expect(OnDeviceDecimaEngine.load({ ort: failing, modelDir: MODEL_DIR, readText })).rejects.toThrow('boom');
});

describe('load() releases sessions it created when a later step fails (no model files)', () => {
  // Smallest tokenizer.json the HF port accepts: a two-piece Unigram model, every pipeline stage null.
  const MIN_TOKENIZER = JSON.stringify({
    normalizer: null, pre_tokenizer: null, post_processor: null, decoder: null, added_tokens: [],
    model: { type: 'Unigram', unk_id: 0, vocab: [['<unk>', 0], ['a', -1]] },
  });
  const MIN_CONFIG = JSON.stringify({ temperature: 1, ordinal: { ord_g_w: [], ord_g_b: 0, ord_gap_w: [], ord_gap_b: 0 } });
  const minRead = async (p: string) => (p.endsWith('decima.json') ? MIN_CONFIG : p.endsWith('tokenizer.json') ? MIN_TOKENIZER : '{}');

  const fakeSession = () => ({ inputNames: [], outputNames: [], run: async () => ({}), release: jest.fn(async () => {}) });
  // No unhandled rejections: jest-circus replaces the host process's 'unhandledRejection' listeners with one that fails
  // the running test (a process.on spy here would sit on the sandbox's own emitter and never fire), so each test
  // flushes the macrotask queue before it ends. Verified by injecting `void Promise.reject(...)` into load()'s catch:
  // both tests then fail with that error.
  const flush = () => new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setImmediate(r)));

  test('scorer create rejects → load rejects with that error and releases the encoder session', async () => {
    const encoder = fakeSession();
    const fakeOrt = {
      Tensor: ort.Tensor,
      InferenceSession: {
        create: async (p: string) => {
          if (p.endsWith('scorer.onnx')) throw new Error('scorer failed');
          return encoder as never;
        },
      },
    };
    await expect(OnDeviceDecimaEngine.load({ ort: fakeOrt, modelDir: '/m', readText: minRead })).rejects.toThrow('scorer failed');
    await flush();
    expect(encoder.release).toHaveBeenCalledTimes(1);
  });

  test('readText rejects → load rejects and releases both sessions', async () => {
    const sessions: Record<string, ReturnType<typeof fakeSession>> = { 'encoder.onnx': fakeSession(), 'scorer.onnx': fakeSession() };
    const fakeOrt = {
      Tensor: ort.Tensor,
      InferenceSession: {
        create: async (p: string) => {
          await new Promise((r) => setTimeout(r, 10)); // still creating when the read fails
          return sessions[p.split('/').pop()!] as never;
        },
      },
    };
    const failingRead = async (p: string) => {
      if (p.endsWith('tokenizer.json')) throw new Error('read failed');
      return minRead(p);
    };
    await expect(OnDeviceDecimaEngine.load({ ort: fakeOrt, modelDir: '/m', readText: failingRead })).rejects.toThrow('read failed');
    await flush();
    expect(sessions['encoder.onnx'].release).toHaveBeenCalledTimes(1);
    expect(sessions['scorer.onnx'].release).toHaveBeenCalledTimes(1);
  });
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
