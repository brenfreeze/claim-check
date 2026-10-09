// System One question ↔ Decima question mapping, ported from decima/systemone.py (to_question, system_one answers).
//   choice → choose over "label: description" (the label alone when there is no description)
//   noul   → verify over yes / no; the answer is P(yes)
//   score  → score over the levels, level 0 first; the answer is the expected level Σ i·pᵢ
import { confidence, round4 } from './postprocess';
import { pyStrip } from './text';
import type { ChoiceAnswer, DecimaQuestion, NoulAnswer, Question, ScoreAnswer } from './types';

const MAX_CHOICES = 255;
const MIN_LEVELS = 2;
const MAX_LEVELS = 10;

export class SystemOneError extends Error {}

export function toDecimaQuestion(qid: string, q: Question): { question: DecimaQuestion; keys: string[] } {
  const text = q.instructions ?? qid;
  switch (q.kind) {
    case 'choice': {
      const labels = Object.keys(q.criteria);
      if (labels.length < 2 || labels.length > MAX_CHOICES) throw new SystemOneError(`questions.${qid}: choice needs 2–${MAX_CHOICES} criteria`);
      const choices = labels.map((k) => (pyStrip(q.criteria[k] ?? '') ? `${k}: ${q.criteria[k]}` : k));
      return { question: { text, choices, kind: 'choose' }, keys: labels };
    }
    case 'score': {
      if (q.levels.length < MIN_LEVELS || q.levels.length > MAX_LEVELS) throw new SystemOneError(`questions.${qid}: score needs ${MIN_LEVELS}–${MAX_LEVELS} levels`);
      return { question: { text, choices: [...q.levels], kind: 'score' }, keys: [...q.levels] };
    }
    case 'noul':
      return { question: { text, choices: ['yes', 'no'], kind: 'verify' }, keys: ['yes', 'no'] };
    default:
      throw new SystemOneError(`questions.${qid}: unknown kind ${(q as { kind: unknown }).kind}`);
  }
}

export function toAnswer(kind: Question['kind'], p: readonly number[], keys: readonly string[]): ChoiceAnswer | NoulAnswer | ScoreAnswer {
  if (kind === 'choice') {
    const i = p.indexOf(Math.max(...p));
    return {
      type: 'choice',
      choice: keys[i],
      confidence: round4(confidence(p)),
      probabilities: Object.fromEntries(keys.map((k, j) => [k, round4(p[j])])),
    };
  }
  if (kind === 'score') {
    return {
      type: 'score',
      score: round4(p.reduce((a, v, i) => a + i * v, 0)),
      confidence: round4(confidence(p)),
      legend: Object.fromEntries(keys.map((lv, i) => [String(i), lv])),
      probabilities: Object.fromEntries(p.map((v, i) => [String(i), round4(v)])),
    };
  }
  return { type: 'noul', noul: round4(p[0]) };
}
