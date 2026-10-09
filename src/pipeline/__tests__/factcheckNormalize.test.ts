// Keyword map covers English + Filipino; false/misleading are checked before true so phrases like
// "not true" and "half true" don't fall through to the `true` keyword.
import { normalizeRating } from '../../../scripts/factcheck-normalize';

describe('normalizeRating', () => {
  test.each([
    ['MALI', 'false'],
    ['Hindi totoo', 'false'],
    ['Misleading', 'misleading'],
    ['Missing context', 'misleading'],
    ['Half true', 'misleading'],
    ['Not true', 'false'],
    ['True', 'true'],
    ['Totoo', 'true'],
    ['Satire', 'misleading'],
    ['Unproven', 'other'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(normalizeRating(input)).toBe(expected);
  });
});
