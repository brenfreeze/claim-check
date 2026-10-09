// DecisionEngine backed by a text LLM — in the app, Apple's on-device Foundation Model (modules/apple-llm).
// The model reads the System One question as a multiple-choice prompt and replies `<option> | <confidence>`; the
// reply becomes the same Decision / AnswerFor shapes as the Decima engine. No token probabilities exist here: the chosen
// option gets the model's stated confidence (clamped) and the others share the remainder, so `probs` are a coarse,
// self-reported calibration rather than Decima's softmax. The backend is injected, so this file stays platform-neutral.
import { toAnswer, toDecimaQuestion } from './systemOne';
import type { AnswerFor, DecimaQuestion, Decision, DecisionEngine, Question } from './types';

export interface LlmBackend {
  /** One stateless completion: system instructions + user prompt → the model's reply text. */
  respond(instructions: string, prompt: string): Promise<string>;
}

export interface LlmEngineOptions {
  backend: LlmBackend;
  /** Task guidance appended to the system instructions (e.g. how fact-check refutations count). */
  domainInstructions?: string;
  /** Confidence used when the reply names an option but no number (0–1). */
  defaultConfidence?: number;
}

const now = () => globalThis.performance?.now() ?? Date.now();
const MAX_CONFIDENCE = 0.98;

const BASE_INSTRUCTIONS =
  'You are a decision engine. You read a situation and answer one multiple-choice question about it. ' +
  'Reply on one line in the form `<option> | <confidence>`, where <option> is copied exactly from the option list and ' +
  '<confidence> is a number from 0 to 100 for how sure you are. Do not explain.';

/** The label the model should answer with: "label: description" options are answered by their label. */
const labelOf = (choice: string) => {
  const i = choice.indexOf(': ');
  return i > 0 ? choice.slice(0, i) : choice;
};

export function buildPrompt(state: string, q: DecimaQuestion, domainInstructions?: string): { instructions: string; prompt: string } {
  const instructions = domainInstructions ? `${BASE_INSTRUCTIONS}\n${domainInstructions}` : BASE_INSTRUCTIONS;
  const described = q.choices.some((c) => labelOf(c) !== c);
  const options = q.choices.map((c) => `- ${c}\n`).join('');
  const levels = q.kind === 'score' ? 'The options are ordered levels, lowest first.\n' : '';
  const labelHint = described ? 'Answer with the label before the colon.\n' : '';
  return { instructions, prompt: `Situation:\n${state}\n\nQuestion: ${q.text}\nOptions:\n${options}${levels}${labelHint}Answer:` };
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** First option mentioned in the reply (ties → longer label) and the confidence stated after it (0–1), if any. */
export function parseAnswer(text: string, labels: readonly string[]): { index: number; confidence: number | null } {
  const lower = text.toLowerCase();
  let best: { index: number; at: number; len: number } | null = null;
  labels.forEach((label, index) => {
    const needle = label.toLowerCase();
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      if (isWordChar(lower[at - 1]) || isWordChar(lower[at + needle.length])) continue;
      if (!best || at < best.at || (at === best.at && needle.length > best.len)) best = { index, at, len: needle.length };
      break;
    }
  });
  if (!best) throw new Error(`LLM reply names no option: ${JSON.stringify(text.slice(0, 120))}`);
  const { index, at, len } = best;
  const num = text.slice(at + len).match(/(\d+(?:\.\d+)?)/);
  const value = num ? Number(num[1]) : null;
  const confidence = value === null ? null : Math.min(1, value > 1 ? value / 100 : value);
  return { index, confidence };
}

export class LlmDecisionEngine implements DecisionEngine {
  readonly id = 'apple-on-device' as const;
  private readonly backend: LlmBackend;
  private readonly domainInstructions?: string;
  private readonly defaultConfidence: number;

  constructor({ backend, domainInstructions, defaultConfidence = 0.6 }: LlmEngineOptions) {
    this.backend = backend;
    this.domainInstructions = domainInstructions;
    this.defaultConfidence = defaultConfidence;
  }

  /** One decision; `probs` puts the stated confidence on the chosen option and splits the rest evenly. */
  async decide(state: string, q: DecimaQuestion): Promise<Decision & { raw: string }> {
    const t0 = now();
    const { instructions, prompt } = buildPrompt(state, q, this.domainInstructions);
    const raw = await this.backend.respond(instructions, prompt);
    const t1 = now();
    const K = q.choices.length;
    const { index, confidence } = parseAnswer(raw, q.choices.map(labelOf));
    const c = Math.min(MAX_CONFIDENCE, Math.max(1 / K + 0.01, confidence ?? this.defaultConfidence));
    const probs = q.choices.map((_, i) => (i === index ? c : (1 - c) / (K - 1)));
    return {
      probs,
      choices: [...q.choices],
      raw,
      timings: { tokenizeMs: 0, encodeChoicesMs: 0, encodeStateMs: 0, scoreMs: t1 - t0, totalMs: now() - t0 },
    };
  }

  async systemOne<Q extends Record<string, Question>>(state: string, questions: Q): Promise<{ [K in keyof Q]: AnswerFor<Q[K]> }> {
    const answers: Record<string, unknown> = {};
    for (const [qid, spec] of Object.entries(questions)) {
      const { question, keys } = toDecimaQuestion(qid, spec);
      const decision = await this.decide(state, question);
      answers[qid] = toAnswer(spec.kind, decision.probs, keys);
    }
    return answers as { [K in keyof Q]: AnswerFor<Q[K]> };
  }
}
