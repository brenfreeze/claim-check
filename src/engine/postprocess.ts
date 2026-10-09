// What happens after scorer.onnx, ported from decima/runtime.py (_score, ordinal), decima/longdoc.py (probs) and
// decima/systemone.py (confidence, rounding). Late-interaction scoring itself is inside the scorer graph.

export function logSoftmax(x: readonly number[]): number[] {
  const m = Math.max(...x);
  const shifted = x.map((v) => v - m);
  const lse = Math.log(shifted.reduce((a, v) => a + Math.exp(v), 0));
  return shifted.map((v) => v - lse);
}

export function softmax(x: readonly number[]): number[] {
  const m = Math.max(...x);
  const e = x.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

const softplus = (x: number) => Math.max(x, 0) + Math.log1p(Math.exp(-Math.abs(x)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Ordinal head weights, shipped in decima.json under "ordinal". */
export interface OrdinalWeights {
  gW: ArrayLike<number>;
  gB: number;
  gapW: ArrayLike<number>;
  gapB: number;
}

/** DecimaOnnx.ordinal: log-probabilities over K ordered levels from temperature-scaled scores s and choice vectors z. */
export function ordinalLogProbs(s: readonly number[], z: readonly ArrayLike<number>[], w: OrdinalWeights): number[] {
  const K = s.length;
  const expected = softmax(s).reduce((a, p, i) => a + p * i, 0) - (K - 1) / 2;
  const d = z[0].length;
  const zMean = new Float64Array(d);
  for (const row of z) for (let j = 0; j < d; j++) zMean[j] += row[j] / K;
  const g = dot(zMean, w.gW) + w.gB + expected;
  const gaps = z.map((row) => softplus(dot(row, w.gapW) + w.gapB) + 1e-3);
  const total = gaps.reduce((a, b) => a + b, 0);
  const theta: number[] = [];
  let cum = 0;
  for (let i = 0; i < K - 1; i++) {
    cum += gaps[i];
    theta.push(cum - total / 2);
  }
  const sig = theta.map((t) => sigmoid(g - t));
  const p = [1, ...sig].map((v, i) => v - (i < sig.length ? sig[i] : 0));
  return logSoftmax(p.map((v) => Math.log(Math.max(v, 1e-7))));
}

export type ScoredKind = 'choose' | 'verify' | 'score';

/** Raw scorer scores → probabilities aligned with the choices (decide_logits + probs, non-rank kinds). */
export function probsFromScores(
  scores: readonly number[],
  temperature: number,
  kind: ScoredKind,
  z?: readonly ArrayLike<number>[],
  ordinal?: OrdinalWeights,
): number[] {
  const s = scores.map((v) => v / temperature);
  if (kind === 'score') {
    if (!z || !ordinal) throw new Error('score questions need the scorer z output and ordinal weights');
    return softmax(ordinalLogProbs(s, z, ordinal));
  }
  return softmax(s);
}

/** TypeSafe confidence: (K·pmax − 1)/(K − 1), clipped to [0, 1]; 1 for a single option. */
export function confidence(p: readonly number[]): number {
  const k = p.length;
  if (k <= 1) return 1;
  return Math.max(0, Math.min(1, (k * Math.max(...p) - 1) / (k - 1)));
}

/** Python round(x, 4) on the exact binary value (ties to even differ only on exact ties, which floats rarely hit). */
export function round4(x: number): number {
  return Number(x.toFixed(4));
}
