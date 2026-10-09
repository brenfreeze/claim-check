// Phase 0 test protocol run on device (throwaway, not part of src/engine): tokenizer + output parity against the
// Python export, order invariance, accuracy per language, latency, memory. One fixture file drives every test.
import type { OnDeviceDecimaEngine } from '../engine';
import { choiceTexts, stateText } from '../engine';
import { memSnapshot, resetMemPeak } from '../../modules/mem-probe';
import { reference } from './reference';

type Ref = typeof reference;
type RefItem = Ref['items'][number];

const now = () => globalThis.performance?.now() ?? Date.now();
const eqIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export interface ItemReport {
  id: string;
  lang: string;
  label: string;
  answer: string;
  correct: boolean;
  tokenizerMatch: boolean;
  maxDelta: number;
  orderFlip: boolean;
  probs: number[];
}

export interface FixtureReport {
  items: ItemReport[];
  tokenizerMismatches: number;
  edgeCaseMismatches: number;
  maxDelta: number;
  orderFlips: number;
  accuracy: Record<string, { correct: number; total: number }>;
  ms: number;
}

export async function runFixtures(engine: OnDeviceDecimaEngine): Promise<FixtureReport> {
  const t0 = now();
  const tok = engine.tokenizer;
  const cfg = engine.config;
  const items: ItemReport[] = [];

  for (const it of reference.items as RefItem[]) {
    let tokenizerMatch = true;
    let maxDelta = 0;
    const answers = new Set<string>();
    let canonical: { answer: string; probs: number[] } | undefined;

    for (const [order, run] of Object.entries(it.runs)) {
      // tokenizer parity on this JS engine (Hermes), not just Jest's V8
      const st = stateText(it.state, reference.question, cfg);
      const ct = choiceTexts(tok, reference.question, run.options, cfg.choice_prefix, cfg.max_choice_tokens, cfg.choice_fit ?? false);
      tokenizerMatch &&=
        st === run.stateText &&
        eqIds(tok.encode(st, cfg.max_state_tokens), run.stateIds) &&
        ct.every((t, i) => t === run.choiceTexts[i] && eqIds(tok.encode(t, cfg.max_choice_tokens), run.choiceIds[i]));

      const d = await engine.decide(it.state, { text: reference.question, choices: run.options, kind: 'choose' });
      maxDelta = Math.max(maxDelta, ...d.probs.map((p, i) => Math.abs(p - run.probs[i])));
      const answer = run.options[d.probs.indexOf(Math.max(...d.probs))];
      answers.add(answer);
      if (order === 'canonical') canonical = { answer, probs: d.probs };
    }
    items.push({
      id: it.id, lang: it.lang, label: it.label, answer: canonical!.answer, correct: canonical!.answer === it.label,
      tokenizerMatch, maxDelta, orderFlip: answers.size > 1, probs: canonical!.probs,
    });
  }

  const edgeCaseMismatches = reference.tokenizerEdgeCases.filter((e) => !eqIds(tok.encode(e.text, e.maxLen), e.ids)).length;
  const accuracy: FixtureReport['accuracy'] = {};
  for (const r of items) {
    accuracy[r.lang] ??= { correct: 0, total: 0 };
    accuracy[r.lang].total++;
    if (r.correct) accuracy[r.lang].correct++;
  }
  return {
    items,
    tokenizerMismatches: items.filter((r) => !r.tokenizerMatch).length,
    edgeCaseMismatches,
    maxDelta: Math.max(...items.map((r) => r.maxDelta)),
    orderFlips: items.filter((r) => r.orderFlip).length,
    accuracy,
    ms: now() - t0,
  };
}

export interface BenchReport {
  firstMs: number;
  n: number;
  medianMs: number;
  p95Ms: number;
  meanStageMs: { tokenize: number; encodeState: number; score: number };
  memory: { before: ReturnType<typeof memSnapshot>; after: ReturnType<typeof memSnapshot>; maxPssMb: number; peakReset: boolean };
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];

/** First decision (choice encodings uncached), then n warm decisions on one fixture; memory sampled throughout. */
export async function benchmark(engine: OnDeviceDecimaEngine, n = 50, fixtureIndex = 0): Promise<BenchReport> {
  const it = reference.items[fixtureIndex];
  const q = { text: reference.question, choices: reference.options, kind: 'choose' as const };
  const peakReset = resetMemPeak();
  const before = memSnapshot();
  const first = await engine.decide(it.state, { ...q, choices: [...q.choices] });
  const total: number[] = [];
  const stage = { tokenize: 0, encodeState: 0, score: 0 };
  let maxPssMb = before.pssMb;
  for (let i = 0; i < n; i++) {
    const t0 = now();
    const d = await engine.decide(it.state, { ...q, choices: [...q.choices] });
    total.push(now() - t0);
    stage.tokenize += d.timings.tokenizeMs / n;
    stage.encodeState += d.timings.encodeStateMs / n;
    stage.score += d.timings.scoreMs / n;
    if (i % 10 === 9) maxPssMb = Math.max(maxPssMb, memSnapshot().pssMb);
  }
  const after = memSnapshot();
  total.sort((a, b) => a - b);
  return {
    firstMs: first.timings.totalMs,
    n,
    medianMs: percentile(total, 0.5),
    p95Ms: percentile(total, 0.95),
    meanStageMs: stage,
    memory: { before, after, maxPssMb: Math.max(maxPssMb, after.pssMb), peakReset },
  };
}
