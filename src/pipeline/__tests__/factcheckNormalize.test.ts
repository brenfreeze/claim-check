// Keyword map covers English + Filipino, matched on word boundaries (Unicode-aware); false/misleading are
// checked before true so phrases like "not true" and "half true" don't fall through to the `true` keyword,
// and a long free-text rating never maps to `true` off an incidental word match (e.g. "fact").
import { normalizeRating } from '../../../scripts/factcheck-normalize';

// 100 chars, contains "fact" as a substring of "factors"/"facts" but no false/misleading keyword.
const LONG_RATING_WITH_FACT =
  'This lengthy review statement mentions several facts and factors but uses no short rating keyword here.';

describe('normalizeRating', () => {
  test.each([
    ['MALI', 'false'],
    ['Mali', 'false'],
    ['Hindi totoo', 'false'],
    ['Misleading', 'misleading'],
    ['Missing context', 'misleading'],
    ['Half true', 'misleading'],
    ['Not true', 'false'],
    ['True', 'true'],
    ['Totoo', 'true'],
    ['Satire', 'misleading'],
    ['Unproven', 'other'],
    ['Untrue', 'false'],
    ['Kailangan ng konteksto', 'misleading'],
    ['PEKE', 'false'],
    [LONG_RATING_WITH_FACT, 'other'],
    ['Malinaw', 'other'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(normalizeRating(input)).toBe(expected);
  });

  test('the long "fact" sentence fixture is actually long enough to exercise the length gate', () => {
    expect(LONG_RATING_WITH_FACT.length).toBeGreaterThan(60);
  });
});
