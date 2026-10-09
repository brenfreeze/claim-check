// Phase 0 protocol for an LLM-backed engine (throwaway, not part of src/engine): accuracy per language, answer
// flips across the three option orders, latency and refusals, on the same fixtures and orders as the Decima run.
// Two framings: one-step (the 3-way verdict question) and two-step (a relevance noul first, then supports/contradicts).
import type { LlmDecisionEngine } from '../engine';
import reference from '../../fixtures/phase0.reference.json';

const now = () => globalThis.performance?.now() ?? Date.now();
const RELEVANCE = 'The evidence is about the same claim, event or announcement as the claim.';

export interface LlmItemReport {
  id: string;
  lang: string;
  label: string;
  answer: string;
  correct: boolean;
  orderFlip: boolean;
  errors: string[];
  raw: string;
}

export interface LlmFixtureReport {
  mode: 'one-step' | 'two-step';
  items: LlmItemReport[];
  accuracy: Record<string, { correct: number; total: number }>;
  orderFlips: number;
  refusals: number;
  latencyMs: { median: number; p95: number; n: number };
  ms: number;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? NaN;

async function oneStep(engine: LlmDecisionEngine, state: string, options: string[]) {
  const d = await engine.decide(state, { text: reference.question, choices: options, kind: 'choose' });
  return { answer: options[d.probs.indexOf(Math.max(...d.probs))], raw: d.raw };
}

async function twoStep(engine: LlmDecisionEngine, state: string, options: string[]) {
  const rel = await engine.decide(state, { text: RELEVANCE, choices: ['yes', 'no'], kind: 'verify' });
  if (rel.probs[0] < 0.5) return { answer: 'unrelated', raw: `relevance: ${rel.raw}` };
  const verdictOptions = options.filter((o) => o !== 'unrelated');
  const d = await engine.decide(state, { text: reference.question, choices: verdictOptions, kind: 'choose' });
  return { answer: verdictOptions[d.probs.indexOf(Math.max(...d.probs))], raw: `relevance: ${rel.raw} · verdict: ${d.raw}` };
}

export async function runLlmFixtures(engine: LlmDecisionEngine, mode: 'one-step' | 'two-step'): Promise<LlmFixtureReport> {
  const t0 = now();
  const decideOne = mode === 'one-step' ? oneStep : twoStep;
  const latencies: number[] = [];
  const items: LlmItemReport[] = [];
  let refusals = 0;

  for (const it of reference.items) {
    const answers = new Set<string>();
    const errors: string[] = [];
    let canonical = { answer: 'error', raw: '' };
    for (const [order, run] of Object.entries(it.runs)) {
      const ts = now();
      try {
        const r = await decideOne(engine, it.state, run.options);
        latencies.push(now() - ts);
        answers.add(r.answer);
        if (order === 'canonical') canonical = r;
      } catch (e) {
        refusals++;
        errors.push(`${order}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
      }
    }
    items.push({
      id: it.id, lang: it.lang, label: it.label, answer: canonical.answer, correct: canonical.answer === it.label,
      orderFlip: answers.size > 1, errors, raw: canonical.raw.slice(0, 200),
    });
  }

  const accuracy: LlmFixtureReport['accuracy'] = {};
  for (const r of items) {
    accuracy[r.lang] ??= { correct: 0, total: 0 };
    accuracy[r.lang].total++;
    if (r.correct) accuracy[r.lang].correct++;
  }
  latencies.sort((a, b) => a - b);
  return {
    mode, items, accuracy, refusals,
    orderFlips: items.filter((r) => r.orderFlip).length,
    latencyMs: { median: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), n: latencies.length },
    ms: now() - t0,
  };
}

/** Fact-check guidance for the verdict prompt. Written after seeing Decima misread refutations on these fixtures, so
 *  fixture accuracy with it is not fully held out — confirm on fresh pairs. */
export const FACT_CHECK_INSTRUCTIONS =
  'You judge claims from Philippine social media, written in English, Filipino or Taglish, against an evidence excerpt ' +
  'from a fact-check or news report. A fact-checker stating there is no such announcement, or an official denial, ' +
  'contradicts the claim. Evidence about a different person, event or announcement is unrelated.';
