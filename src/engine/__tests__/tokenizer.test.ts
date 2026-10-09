// SP-03: tokenizer ids and masks match the Python (HF transformers) tokenizer exactly.
import * as path from 'path';
import { XlmrTokenizer } from '../tokenizer';
import { allRuns, MODEL_DIR, readText, reference } from './reference';

const cfg = reference.model.config;
let tok: XlmrTokenizer;

beforeAll(async () => {
  tok = XlmrTokenizer.fromJson(
    await readText(path.join(MODEL_DIR, 'tokenizer/tokenizer.json')),
    await readText(path.join(MODEL_DIR, 'tokenizer/tokenizer_config.json')),
  );
});

describe('state ids match Python for every fixture and option order', () => {
  test.each(allRuns)('$name', ({ run }) => {
    expect(tok.encode(run.stateText, cfg.max_state_tokens)).toEqual(run.stateIds);
  });
});

describe('choice ids match Python for every fixture and option order', () => {
  test.each(allRuns)('$name', ({ run }) => {
    expect(run.choiceTexts.map((t) => tok.encode(t, cfg.max_choice_tokens))).toEqual(run.choiceIds);
  });
});

describe('edge cases (accents, emoji, CJK, whitespace, truncation)', () => {
  test.each(reference.tokenizerEdgeCases.map((e, i) => ({ ...e, name: `#${i} max=${e.maxLen} ${JSON.stringify(e.text.slice(0, 40))}` })))(
    '$name',
    ({ text, maxLen, ids }) => {
      expect(tok.encode(text, maxLen)).toEqual(ids);
    },
  );
});

test('batch padding: pad id 1, mask 0 on padding, rows padded to the longest', () => {
  const { ids, mask, width } = tok.encodeBatch(['passage: a', 'passage: a much longer option text'], cfg.max_choice_tokens);
  expect(width).toBe(Math.max(...ids.map((r) => r.length)));
  const short = tok.encode('passage: a', cfg.max_choice_tokens);
  expect(ids[0].slice(0, short.length)).toEqual(short);
  expect(ids[0].slice(short.length).every((x) => x === 1)).toBe(true);
  expect(mask[0]).toEqual([...short.map(() => 1), ...Array(width - short.length).fill(0)]);
});

test('patches/@huggingface+tokenizers+0.2.0.patch is applied (trie-free Unigram)', () => {
  // XlmrTokenizer keeps the HF Tokenizer in private `tok`; its Unigram model is `.model`. Unpatched 0.2.0 builds a
  // 250k-piece CharTrie (`trie`) and has no `max_piece_chars`. If this fails, run `npm install` (postinstall applies it).
  const model = (tok as any).tok.model;
  expect(model.max_piece_chars).toBe(16);
  expect(model.trie).toBeUndefined();
});
