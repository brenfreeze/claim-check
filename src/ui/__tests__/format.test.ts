import { detectLanguage, splitSentences, writingSignals } from '../../core/text';
import { SAMPLE_POST } from './samplePost';
import { confidenceLabel, corpusLine, ratingVerdict, recentMeta, relativeTime, sourceSummary, verdictTotals } from '../format';

const now = new Date('2026-10-10T12:00:00Z');

describe('format', () => {
  test('verdictTotals counts each verdict', () => {
    expect(verdictTotals([{ verdict: 'contradicted' }, { verdict: 'supported' }, { verdict: 'contradicted' }, { verdict: 'unverified' }])).toEqual({
      contradicted: 2,
      supported: 1,
      unverified: 1,
    });
  });

  test('confidenceLabel shows the gate only for Unverified claims under it', () => {
    expect(confidenceLabel({ verdict: 'unverified', confidence: 0.58 }, 0.7)).toBe('0.58 · below 0.70');
    expect(confidenceLabel({ verdict: 'contradicted', confidence: 0.91 }, 0.7)).toBe('0.91');
  });

  test('sourceSummary lists two related publishers then a count', () => {
    const ev = [
      { publisher: 'PAGASA', stance: 'contradicts' as const },
      { publisher: 'Vera Files', stance: 'contradicts' as const },
      { publisher: 'Outlet', stance: 'unrelated' as const },
    ];
    expect(sourceSummary(ev)).toBe('PAGASA · Vera Files · +1');
    expect(sourceSummary(ev.slice(0, 2))).toBe('PAGASA · Vera Files');
  });

  test('relativeTime buckets', () => {
    expect(relativeTime('2026-10-10T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-10T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-10-10T10:00:00Z', now)).toBe('2h ago');
    expect(relativeTime('2026-10-09T10:00:00Z', now)).toBe('Yesterday');
    expect(relativeTime('2026-10-06T10:00:00Z', now)).toBe('4 days ago');
  });

  test('corpusLine', () => {
    expect(corpusLine({ count: 1284, syncedAt: '2026-10-10T10:00:00Z' }, now)).toBe(
      'Checked on-device against 1,284 saved fact-checks · synced 2h ago',
    );
  });

  test('ratingVerdict maps fact-check ratings to pill colors', () => {
    expect(ratingVerdict('false')).toBe('contradicted');
    expect(ratingVerdict('misleading')).toBe('contradicted');
    expect(ratingVerdict('true')).toBe('supported');
    expect(ratingVerdict('needs context')).toBe('unverified');
  });

  test('recentMeta summarises verdicts and queued rechecks', () => {
    expect(
      recentMeta('2026-10-09T10:00:00Z', [{ verdict: 'contradicted' }, { verdict: 'unverified', enrichment: { status: 'queued' } }], false, now),
    ).toBe('Yesterday · 1 contradicted · 1 unverified · 1 queued');
    expect(recentMeta('2026-10-10T11:59:59Z', [], true, now)).toBe('just now · checking…');
  });
});

describe('text', () => {
  test('splitSentences keeps "Signal No. 4" and folds "GRABE!" into the next sentence', () => {
    const s = splitSentences(SAMPLE_POST);
    expect(s).toHaveLength(5);
    expect(s[0]).toBe('GRABE! Signal No. 4 na daw sa Metro Manila mamayang gabi sabi ng PAGASA.');
    expect(s[4]).toBe('Share niyo na bago ma-delete!!!');
  });

  test('detectLanguage and writingSignals on the sample post', () => {
    expect(detectLanguage(SAMPLE_POST)).toBe('Taglish');
    expect(detectLanguage('')).toBeNull();
    expect(writingSignals(SAMPLE_POST)).toEqual(['All-caps urgency', 'Hearsay (“daw”)', 'Pressure to share']);
  });
});
