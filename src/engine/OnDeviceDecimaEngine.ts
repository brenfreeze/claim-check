// Decima-small on device: tokenizer + encoder.onnx + scorer.onnx + post-processing behind DecisionEngine.
// The ONNX Runtime module and the file reader are injected, so the same class runs on onnxruntime-react-native
// in the app and on onnxruntime-node in Jest (both implement the onnxruntime-common API).
import type { InferenceSession, Tensor } from 'onnxruntime-common';
import { probsFromScores, type OrdinalWeights } from './postprocess';
import { toAnswer, toDecimaQuestion } from './systemOne';
import { choiceTexts, stateText } from './text';
import { XlmrTokenizer } from './tokenizer';
import type { AnswerFor, DecimaQuestion, Decision, DecisionEngine, Question } from './types';

export interface OrtModule {
  InferenceSession: { create(path: string, options?: InferenceSession.SessionOptions): Promise<InferenceSession> };
  Tensor: typeof Tensor;
}

export interface LoadOptions {
  ort: OrtModule;
  /** directory holding encoder.onnx, scorer.onnx, decima.json and tokenizer/ */
  modelDir: string;
  readText: (path: string) => Promise<string>;
  sessionOptions?: InferenceSession.SessionOptions;
  /** maps a model file path to what InferenceSession.create expects (e.g. strips file:// on device) */
  sessionPath?: (path: string) => string;
}

export interface DecimaConfig {
  temperature: number;
  max_state_tokens: number;
  max_choice_tokens: number;
  state_prefix: string;
  choice_prefix: string;
  question_in_state: boolean;
  question_in_choices: boolean;
  choice_fit?: boolean;
  ordinal: { ord_g_w: number[]; ord_g_b: number; ord_gap_w: number[]; ord_gap_b: number };
}

export interface LoadTimings {
  readFilesMs: number;
  /** JSON.parse of the 17 MB tokenizer.json */
  tokenizerParseMs: number;
  /** building the Unigram model from the parsed JSON */
  tokenizerMs: number;
  /** load start → session resolution observed on the JS thread (overlaps the tokenizer stages) */
  encoderMs: number;
  /** load start → session resolution observed on the JS thread (overlaps the tokenizer stages) */
  scorerMs: number;
  /** time spent awaiting the sessions after the tokenizer finished (> 0 ⇒ sessions were the critical path) */
  sessionWaitMs: number;
  /** wall time of all load work */
  totalMs: number;
}

export interface GraphInfo {
  encoder: { inputNames: readonly string[]; outputNames: readonly string[] };
  scorer: { inputNames: readonly string[]; outputNames: readonly string[] };
}

const now = () => globalThis.performance?.now() ?? Date.now();
const join = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`;
const CHOICE_CACHE_MAX = 256;

export class OnDeviceDecimaEngine implements DecisionEngine {
  readonly id = 'decima-local' as const;
  private readonly choiceCache = new Map<string, { h: Tensor; mask: Tensor }>();
  private readonly ordinal: OrdinalWeights;

  private constructor(
    private readonly ort: OrtModule,
    private readonly encoder: InferenceSession,
    private readonly scorer: InferenceSession,
    private readonly tok: XlmrTokenizer,
    private readonly cfg: DecimaConfig,
    readonly loadTimings: LoadTimings,
  ) {
    const o = cfg.ordinal;
    this.ordinal = { gW: o.ord_g_w, gB: o.ord_g_b, gapW: o.ord_gap_w, gapB: o.ord_gap_b };
  }

  static async load({ ort, modelDir, readText, sessionOptions, sessionPath = (p) => p }: LoadOptions): Promise<OnDeviceDecimaEngine> {
    const t0 = now();
    // Session creation runs natively off the JS thread: start both first, then read + build the tokenizer meanwhile.
    const timed = (p: Promise<InferenceSession>) => p.then((s) => ({ s, ms: now() - t0 }));
    const encoderP = timed(ort.InferenceSession.create(sessionPath(join(modelDir, 'encoder.onnx')), sessionOptions));
    const scorerP = timed(ort.InferenceSession.create(sessionPath(join(modelDir, 'scorer.onnx')), sessionOptions));
    const sessions = Promise.all([encoderP, scorerP]);
    sessions.catch(() => {}); // surfaced by the await below; avoids an unhandled rejection while the tokenizer builds

    try {
      const [cfgText, tokText, tokCfgText] = await Promise.all([
        readText(join(modelDir, 'decima.json')),
        readText(join(modelDir, 'tokenizer/tokenizer.json')),
        readText(join(modelDir, 'tokenizer/tokenizer_config.json')),
      ]);
      const cfg: DecimaConfig = JSON.parse(cfgText); // tiny; parsed first so a malformed decima.json fails before the tokenizer build
      const t1 = now();
      const tokJson = JSON.parse(tokText);
      const tp = now();
      const tok = XlmrTokenizer.fromJson(tokJson, tokCfgText);
      const t2 = now();
      const [encoder, scorer] = await sessions;
      const t3 = now();
      const timings: LoadTimings = {
        readFilesMs: t1 - t0,
        tokenizerParseMs: tp - t1,
        tokenizerMs: t2 - tp,
        encoderMs: encoder.ms,
        scorerMs: scorer.ms,
        sessionWaitMs: t3 - t2,
        totalMs: t3 - t0,
      };
      return new OnDeviceDecimaEngine(ort, encoder.s, scorer.s, tok, cfg, timings);
    } catch (err) {
      // Free whichever native sessions did get created, then surface the original failure.
      const settled = await Promise.allSettled([encoderP, scorerP]);
      for (const r of settled) if (r.status === 'fulfilled') void r.value.s.release().catch(() => {});
      throw err;
    }
  }

  /** Frees both ONNX Runtime sessions; the engine is unusable afterwards. */
  async release(): Promise<void> {
    this.choiceCache.clear();
    await Promise.all([this.encoder.release(), this.scorer.release()]);
  }

  /** For on-device tokenizer parity checks. */
  get tokenizer(): XlmrTokenizer {
    return this.tok;
  }

  get config(): Readonly<DecimaConfig> {
    return this.cfg;
  }

  get graphInfo(): GraphInfo {
    const io = (s: InferenceSession) => ({ inputNames: s.inputNames, outputNames: s.outputNames });
    return { encoder: io(this.encoder), scorer: io(this.scorer) };
  }

  /** One decision: probabilities over q.choices (softmax for choose/verify, ordinal head for score). */
  async decide(state: string, q: DecimaQuestion): Promise<Decision> {
    const t0 = now();
    const { cfg } = this;
    const stateIds = this.tok.encode(stateText(state, q.text, cfg), cfg.max_state_tokens);
    const t1 = now();

    const { choices, encodeMs } = await this.choices(q);
    const t2 = now();

    const h = await this.encode([stateIds], [stateIds.map(() => 1)], stateIds.length);
    const t3 = now();

    const out = await this.scorer.run({ state_h: h.h, state_mask: h.mask, choice_h: choices.h, choice_mask: choices.mask });
    const scores = Array.from(out.scores.data as Float32Array);
    const zData = out.z.data as Float32Array;
    const d = out.z.dims[1];
    const z = scores.map((_, i) => zData.subarray(i * d, (i + 1) * d));
    const probs = probsFromScores(scores, cfg.temperature, q.kind, z, this.ordinal);
    const t4 = now();

    return {
      probs,
      choices: [...q.choices],
      timings: { tokenizeMs: t1 - t0, encodeChoicesMs: encodeMs, encodeStateMs: t3 - t2, scoreMs: t4 - t3, totalMs: t4 - t0 },
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

  /** Choice encodings, cached per (question, choices) because the question is rendered into every option. */
  private async choices(q: DecimaQuestion): Promise<{ choices: { h: Tensor; mask: Tensor }; encodeMs: number }> {
    const qt = this.cfg.question_in_choices ? q.text : '';
    const key = JSON.stringify([qt, q.choices]);
    const hit = this.choiceCache.get(key);
    if (hit) return { choices: hit, encodeMs: 0 };
    const t0 = now();
    const texts = choiceTexts(this.tok, qt, q.choices, this.cfg.choice_prefix, this.cfg.max_choice_tokens, this.cfg.choice_fit ?? false);
    const batch = this.tok.encodeBatch(texts, this.cfg.max_choice_tokens);
    const enc = await this.encode(batch.ids, batch.mask, batch.width);
    if (this.choiceCache.size >= CHOICE_CACHE_MAX) this.choiceCache.clear();
    this.choiceCache.set(key, enc);
    return { choices: enc, encodeMs: now() - t0 };
  }

  private async encode(ids: number[][], mask: number[][], width: number): Promise<{ h: Tensor; mask: Tensor }> {
    const { Tensor } = this.ort;
    const dims = [ids.length, width];
    const int64 = (rows: number[][]) => BigInt64Array.from(rows.flat(), (x) => BigInt(x));
    const maskT = new Tensor('int64', int64(mask), dims);
    const out = await this.encoder.run({ input_ids: new Tensor('int64', int64(ids), dims), attention_mask: maskT });
    return { h: out.token_states, mask: maskT };
  }
}
