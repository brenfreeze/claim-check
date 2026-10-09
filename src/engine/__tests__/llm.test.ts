// LlmDecisionEngine: System One questions answered by a text LLM (Apple's on-device model in the app), with the
// backend injected so the prompt/parse/probability logic is tested here without any model.
import { buildPrompt, LlmDecisionEngine, parseAnswer, type LlmBackend } from '../LlmDecisionEngine';
import type { DecimaQuestion } from '../types';

const verdict: DecimaQuestion = { text: 'Does the evidence support the claim?', choices: ['supports', 'contradicts', 'unrelated'], kind: 'choose' };
const state = 'Claim: Classes are suspended tomorrow.\nEvidence: The city said classes will push through.';

function fakeBackend(reply: string | ((prompt: string) => string)) {
  const calls: { instructions: string; prompt: string }[] = [];
  const backend: LlmBackend = {
    respond: async (instructions, prompt) => {
      calls.push({ instructions, prompt });
      return typeof reply === 'string' ? reply : reply(prompt);
    },
  };
  return { backend, calls };
}

describe('buildPrompt', () => {
  test('carries the state, the question and every option exactly once; instructions fix the reply format', () => {
    const { instructions, prompt } = buildPrompt(state, verdict);
    expect(prompt).toContain(state);
    expect(prompt).toContain(verdict.text);
    for (const c of verdict.choices) expect(prompt.split(`- ${c}\n`).length - 1).toBe(1);
    expect(instructions).toMatch(/<option> \| <confidence>/);
  });

  test('domain instructions are appended to the system instructions', () => {
    expect(buildPrompt(state, verdict, 'Official denials contradict the claim.').instructions).toContain('Official denials contradict the claim.');
  });

  test('"label: description" options are listed whole but answered by label', () => {
    const q: DecimaQuestion = { ...verdict, choices: ['supports: the evidence shows it is true', 'contradicts', 'unrelated'] };
    const { prompt } = buildPrompt(state, q);
    expect(prompt).toContain('- supports: the evidence shows it is true\n');
    expect(prompt).toMatch(/answer with the label before the colon/i);
  });
});

describe('parseAnswer', () => {
  const labels = ['supports', 'contradicts', 'unrelated'];
  test.each([
    ['contradicts | 85', 1, 0.85],
    ['Contradicts|90%', 1, 0.9],
    ['**supports** (confidence 80)', 0, 0.8],
    ['The answer is: unrelated | 0.95', 2, 0.95],
    ['  SUPPORTS | 100 ', 0, 1],
  ])('%p → option %p, confidence %p', (text, index, confidence) => {
    expect(parseAnswer(text, labels)).toEqual({ index, confidence });
  });

  test('missing confidence → null (caller applies the default)', () => {
    expect(parseAnswer('unrelated', labels)).toEqual({ index: 2, confidence: null });
  });

  test('longest label wins when one label contains another', () => {
    expect(parseAnswer('not sure | 60', ['no', 'not sure'])).toEqual({ index: 1, confidence: 0.6 });
  });

  test('earliest mentioned option wins', () => {
    expect(parseAnswer('contradicts, not supports | 70', labels).index).toBe(1);
  });

  test('no option in the reply throws', () => {
    expect(() => parseAnswer('I cannot help with that.', labels)).toThrow(/no option/i);
  });
});

describe('LlmDecisionEngine.decide', () => {
  test('chosen option gets the confidence; the rest share the remainder; probs sum to 1', async () => {
    const { backend, calls } = fakeBackend('contradicts | 80');
    const d = await new LlmDecisionEngine({ backend }).decide(state, verdict);
    expect(d.choices).toEqual(verdict.choices);
    expect(d.probs[1]).toBeCloseTo(0.8, 12);
    expect(d.probs[0]).toBeCloseTo(0.1, 12);
    expect(d.probs[2]).toBeCloseTo(0.1, 12);
    expect(d.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(d.raw).toBe('contradicts | 80');
    expect(calls[0].prompt).toContain(state);
    expect(d.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  test('confidence is clamped so the chosen option stays the argmax and nothing is certain', async () => {
    const low = await new LlmDecisionEngine({ backend: fakeBackend('supports | 5').backend }).decide(state, verdict);
    expect(low.probs.indexOf(Math.max(...low.probs))).toBe(0);
    const high = await new LlmDecisionEngine({ backend: fakeBackend('supports | 100').backend }).decide(state, verdict);
    expect(high.probs[0]).toBeLessThan(1);
    expect(Math.min(...high.probs)).toBeGreaterThan(0);
  });

  test('missing confidence uses the default', async () => {
    const d = await new LlmDecisionEngine({ backend: fakeBackend('unrelated').backend, defaultConfidence: 0.7 }).decide(state, verdict);
    expect(d.probs[2]).toBeCloseTo(0.7, 12);
  });

  test('backend errors propagate (e.g. guardrail refusals)', async () => {
    const backend: LlmBackend = { respond: async () => { throw new Error('May contain sensitive content'); } };
    await expect(new LlmDecisionEngine({ backend }).decide(state, verdict)).rejects.toThrow('sensitive');
  });
});

describe('LlmDecisionEngine.systemOne', () => {
  test('choice, noul and score answers have the System One shapes', async () => {
    const { backend } = fakeBackend((prompt) =>
      prompt.includes('- yes\n') ? 'no | 90' : prompt.includes('- strongly\n') ? 'somewhat | 60' : 'contradicts | 80',
    );
    const engine = new LlmDecisionEngine({ backend });
    expect(engine.id).toBe('apple-on-device');
    const a = await engine.systemOne(state, {
      verdict: { kind: 'choice', instructions: verdict.text, criteria: { supports: '', contradicts: '', unrelated: '' } },
      credible: { kind: 'noul', instructions: 'The evidence shows the claim is true.' },
      strength: { kind: 'score', instructions: 'How strongly does the evidence back the claim?', levels: ['not at all', 'somewhat', 'strongly'] },
    });
    expect(a.verdict).toEqual({ type: 'choice', choice: 'contradicts', confidence: 0.7, probabilities: { supports: 0.1, contradicts: 0.8, unrelated: 0.1 } });
    expect(a.credible).toEqual({ type: 'noul', noul: 0.1 });
    expect(a.strength.type).toBe('score');
    expect(a.strength.score).toBeCloseTo(0.2 * 0 + 0.6 * 1 + 0.2 * 2, 4);
  });
});
