// SP-04 (pure part): scorer scores → probabilities exactly as decima/runtime.py does it.
import { confidence, logSoftmax, ordinalLogProbs, probsFromScores, round4, softmax } from '../postprocess';
import { allRuns, reference } from './reference';

const T = reference.model.config.temperature;

describe('scores / temperature → softmax matches Python probabilities', () => {
  test.each(allRuns)('$name', ({ run }) => {
    const p = probsFromScores(run.scores, T, 'choose');
    p.forEach((x, i) => expect(x).toBeCloseTo(run.probs[i], 6));
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

test('softmax and logSoftmax are stable for large inputs', () => {
  expect(softmax([1000, 1000])).toEqual([0.5, 0.5]);
  const lp = logSoftmax([1000, 0]);
  expect(lp[0]).toBeCloseTo(0, 12);
  expect(Number.isFinite(lp[1])).toBe(true);
});

test('confidence = (K·pmax − 1)/(K − 1), clipped to [0, 1]; 1 for a single option', () => {
  expect(confidence([1 / 3, 1 / 3, 1 / 3])).toBeCloseTo(0, 12);
  expect(confidence([1, 0, 0])).toBe(1);
  expect(confidence([0.6, 0.4])).toBeCloseTo(0.2, 12);
  expect(confidence([1])).toBe(1);
});

test('round4 matches Python round(x, 4) on the reference answers', () => {
  expect(round4(0.57734999)).toBe(0.5773);
  expect(round4(0.12345678)).toBe(0.1235);
});

test('ordinal head: a valid distribution over the levels, mass moves up with the scores', () => {
  const zero = new Float32Array(384);
  const w = new Array(384).fill(0);
  const ord = { gW: w, gB: 0, gapW: w, gapB: 0 };
  const lo = ordinalLogProbs([3, 0, -3], [zero, zero, zero], ord).map(Math.exp);
  const hi = ordinalLogProbs([-3, 0, 3], [zero, zero, zero], ord).map(Math.exp);
  expect(lo.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  expect(hi.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  expect(hi[2]).toBeGreaterThan(lo[2]);
  expect(lo[0]).toBeGreaterThan(hi[0]);
});
