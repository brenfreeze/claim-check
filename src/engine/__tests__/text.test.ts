// Input rendering (decima/runtime.py _state, decima/render.py choice_texts) matches Python byte for byte.
import * as path from 'path';
import { choiceTexts, normalize, stateText } from '../text';
import { XlmrTokenizer } from '../tokenizer';
import { allRuns, MODEL_DIR, readText, reference } from './reference';

const cfg = { ...reference.model.config, state_prefix: 'query: ', choice_prefix: 'passage: ', question_in_state: true };
let tok: XlmrTokenizer;

beforeAll(async () => {
  tok = XlmrTokenizer.fromJson(
    await readText(path.join(MODEL_DIR, 'tokenizer/tokenizer.json')),
    await readText(path.join(MODEL_DIR, 'tokenizer/tokenizer_config.json')),
  );
});

test('normalize: NFC + Python str.strip whitespace set', () => {
  expect(normalize('  é \n')).toBe('é'); // NFC composes e + combining acute
  expect(normalize('\x1c\x85text　')).toBe('text'); // Python whitespace JS trim misses
  expect(normalize('﻿text')).toBe('﻿text'); // JS trim strips BOM, Python does not
});

describe('state text matches Python', () => {
  test.each(allRuns)('$name', ({ item, run }) => {
    expect(stateText(item.state, reference.question, cfg)).toBe(run.stateText);
  });
});

describe('choice texts match Python (legacy rendering, choice_fit false)', () => {
  test.each(allRuns)('$name', ({ run }) => {
    expect(choiceTexts(tok, reference.question, run.options, cfg.choice_prefix, cfg.max_choice_tokens)).toEqual(run.choiceTexts);
  });
});

describe('render fallbacks match Python (fitted rendering when the cut merges options, legacy otherwise)', () => {
  test.each(reference.renderCases.map((c, i) => ({ ...c, name: `case ${i}` })))('$name', ({ question, choices, out }) => {
    expect(choiceTexts(tok, question, choices, cfg.choice_prefix, cfg.max_choice_tokens)).toEqual(out);
  });
});
