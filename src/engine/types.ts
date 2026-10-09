// DecisionEngine contract from the parent PRD (Claim-Check Mobile, Architecture). It mirrors the System One
// wire format, so the on-device engine and the laptop HTTP engine are interchangeable. Answer shapes follow
// Decima's decima/systemone.py (TypeSafe schema): field order, 4-decimal rounding, confidence = (K·pmax − 1)/(K − 1).

export type Question =
  | { kind: 'choice'; instructions: string; criteria: Record<string, string> }
  | { kind: 'noul'; instructions: string }
  | { kind: 'score'; instructions: string; levels: readonly string[] };

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  type: 'noul';
  /** P(yes) */
  noul: number;
}

export interface ScoreAnswer {
  type: 'score';
  /** expected level, Σ i·pᵢ */
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

export type AnswerFor<Q extends Question> = Q extends { kind: 'choice' }
  ? ChoiceAnswer
  : Q extends { kind: 'noul' }
    ? NoulAnswer
    : ScoreAnswer;

export interface DecisionEngine {
  readonly id: 'decima-local' | 'apple-on-device' | 'http';
  systemOne<Q extends Record<string, Question>>(
    state: string,
    questions: Q,
  ): Promise<{ [K in keyof Q]: AnswerFor<Q[K]> }>;
}

/** Decima's own question form (decima/types.py), one level below System One. */
export interface DecimaQuestion {
  text: string;
  choices: readonly string[];
  kind: 'choose' | 'verify' | 'score';
}

export interface DecisionTimings {
  tokenizeMs: number;
  encodeStateMs: number;
  /** 0 when the choice encodings came from the cache */
  encodeChoicesMs: number;
  scoreMs: number;
  totalMs: number;
}

export interface Decision {
  /** aligned with question.choices, sums to 1 */
  probs: number[];
  choices: string[];
  timings: DecisionTimings;
}
