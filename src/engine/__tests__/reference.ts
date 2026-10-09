// Loads the Python reference export (harness/export_reference.py) and the model files for the Jest suites.
import * as fs from 'fs';
import * as path from 'path';

export const ROOT = path.resolve(__dirname, '../../..');
export const MODEL_DIR = path.join(ROOT, 'models/decima-small/onnx/int8');

export interface RefRun {
  options: string[];
  stateText: string;
  choiceTexts: string[];
  stateIds: number[];
  choiceIds: number[][];
  scores: number[];
  probs: number[];
  answer: string;
}

export interface RefItem {
  id: string;
  lang: string;
  label: string;
  state: string;
  runs: Record<string, RefRun>;
  orderInvariant: boolean;
  systemOne: Record<string, unknown>;
}

export interface Reference {
  question: string;
  options: string[];
  items: RefItem[];
  tokenizerEdgeCases: { text: string; maxLen: number; ids: number[] }[];
  renderCases: { question: string; choices: string[]; out: string[] }[];
  systemOneSmoke: { id: string; state: string; questions: Record<string, any>; answers: Record<string, any> }[];
  model: { config: { temperature: number; max_state_tokens: number; max_choice_tokens: number } };
}

export const reference: Reference = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'fixtures/phase0.reference.json'), 'utf8'),
);

export const readText = (p: string) => fs.promises.readFile(p, 'utf8');
export const modelPresent = fs.existsSync(path.join(MODEL_DIR, 'encoder.onnx'));

/** Every (item, order) pair in the reference, flattened for test.each. */
export const allRuns = reference.items.flatMap((it) =>
  Object.entries(it.runs).map(([order, run]) => ({ name: `${it.id}/${order}`, item: it, order, run })),
);
