// XLM-R SentencePiece (Unigram) tokenizer from multilingual-e5-small's tokenizer.json, via the zero-dependency
// @huggingface/tokenizers port. Truncation mirrors HF `tokenizer(text, truncation=True, max_length=n)` for a single
// sequence: keep the first n − 2 content tokens, then wrap them in <s> … </s>.
import { Tokenizer } from '@huggingface/tokenizers';

const BOS = 0; // <s>
const EOS = 2; // </s>
export const PAD_ID = 1; // <pad>

export class XlmrTokenizer {
  private constructor(private readonly tok: Tokenizer) {}

  static fromJson(tokenizerJson: string | object, configJson: string | object): XlmrTokenizer {
    const parse = (x: string | object) => (typeof x === 'string' ? JSON.parse(x) : x);
    return new XlmrTokenizer(new Tokenizer(parse(tokenizerJson), parse(configJson)));
  }

  /** Token ids with <s> … </s>; truncated to maxLen tokens in total when maxLen is given. */
  encode(text: string, maxLen?: number): number[] {
    let ids = this.tok.encode(text, { add_special_tokens: false }).ids;
    if (maxLen !== undefined && ids.length > maxLen - 2) ids = ids.slice(0, Math.max(0, maxLen - 2));
    return [BOS, ...ids, EOS];
  }

  /** Right-padded batch, like `tokenizer(texts, padding=True, truncation=True, max_length=maxLen)`. */
  encodeBatch(texts: readonly string[], maxLen: number): { ids: number[][]; mask: number[][]; width: number } {
    const rows = texts.map((t) => this.encode(t, maxLen));
    const width = Math.max(...rows.map((r) => r.length));
    return {
      ids: rows.map((r) => [...r, ...Array(width - r.length).fill(PAD_ID)]),
      mask: rows.map((r) => [...r.map(() => 1), ...Array(width - r.length).fill(0)]),
      width,
    };
  }
}
