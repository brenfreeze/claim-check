// Input rendering, ported from decima/normalize.py, decima/runtime.py (_state) and decima/render.py (choice_texts).
// Only the non-Persian/Arabic path of normalize() is ported: NFC, then Python's str.strip().
import type { XlmrTokenizer } from './tokenizer';

// Python str.isspace() set (differs from JS \s: adds \x1c-\x1f and \x85, lacks \ufeff)
const PY_WS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'g');
const SPLIT = new RegExp(`[${PY_WS}]+`);

/** Python str.strip() */
export function pyStrip(text: string): string {
  return text.replace(STRIP, '');
}

export function normalize(text: string): string {
  return pyStrip(text.normalize('NFC'));
}

export interface RenderConfig {
  state_prefix: string;
  question_in_state: boolean;
}

/** `query: ` + normalize(question \n state) — the encoder input for the state (question_in_state models). */
export function stateText(state: string, question: string, cfg: RenderConfig): string {
  const body = cfg.question_in_state ? `${question}\n${state}` : state;
  return cfg.state_prefix + normalize(body);
}

const codePoints = (s: string) => [...s].length;

/**
 * One encoder input per option: prefix + "question option", cut to maxLen tokens. Legacy rendering (choice_fit
 * false, Decima-small 1.1) keeps the right-hand cut unless it makes two options identical; then every option is
 * kept whole and only this copy of the question is shortened at a word boundary, with "…" where it was cut.
 */
export function choiceTexts(
  tok: XlmrTokenizer,
  question: string,
  choices: readonly string[],
  prefix: string,
  maxLen: number,
  fit = false,
): string[] {
  if (!fit) {
    const legacy = choices.map((c) => prefix + normalize(`${question} ${c}`));
    const rows = new Set(legacy.map((t) => tok.encode(t, maxLen).join(',')));
    if (rows.size === legacy.length) return legacy;
  }
  return choices.map((c) => {
    const full = prefix + normalize(`${question} ${c}`);
    if (codePoints(full) <= maxLen - 2 || tok.encode(full).length <= maxLen) return full;
    const opt = normalize(c);
    const words = normalize(question).split(SPLIT).filter(Boolean);
    let lo = 0;
    let hi = words.length;
    while (lo < hi) {
      // the longest question head that fits
      const mid = Math.floor((lo + hi + 1) / 2);
      if (tok.encode(`${prefix}${words.slice(0, mid).join(' ')} … ${opt}`).length <= maxLen) lo = mid;
      else hi = mid - 1;
    }
    return lo ? `${prefix}${words.slice(0, lo).join(' ')} … ${opt}` : prefix + opt;
  });
}
