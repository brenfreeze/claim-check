// Sample content for the mock pipeline (the mockups' example post). Delete with the mocks once the real pipeline lands.
// Headlines and summaries in [brackets] are placeholders, as in the mockups.
import type { ClaimResult, EvidenceSource, OcrResult } from './checkTypes';

export const SAMPLE_POST =
  'GRABE! Signal No. 4 na daw sa Metro Manila mamayang gabi sabi ng PAGASA. Walang pasok sa lahat ng public schools sa NCR bukas. Uminom ng salabat na may kalamansi para iwas dengue! May ₱500 rebate daw from Meralco ngayong buwan. Share niyo na bago ma-delete!!!';

export const SAMPLE_OCR: OcrResult = {
  ms: 180,
  sentences: [
    { text: 'Signal No. 4 na daw sa Metro Manila mamayang gabi sabi ng PAGASA.', claimScore: 0.96 },
    { text: 'Walang pasok sa lahat ng public schools sa NCR bukas.', claimScore: 0.93 },
    { text: 'Uminom ng salabat na may kalamansi para iwas dengue!', claimScore: 0.88 },
    { text: 'May ₱500 rebate daw from Meralco ngayong buwan.', claimScore: 0.81 },
    { text: 'Share niyo na bago ma-delete!!!', claimScore: 0.04 },
  ],
};

type ClaimSeed = Omit<ClaimResult, 'id' | 'original' | 'stats'> & {
  match: RegExp;
  decisions: number;
  ms: number;
  /** what Online enrichment turns this claim into */
  enriched?: Omit<ClaimResult, 'id' | 'original' | 'stats' | 'path'> & { decisions: number; ms: number };
};

const fc = (e: Partial<EvidenceSource> & Pick<EvidenceSource, 'publisher' | 'domain' | 'stance' | 'confidence'>): EvidenceSource => ({
  url: `https://${e.domain}`,
  title: '[Fact-check headline]',
  tier: 'A',
  kind: 'factcheck',
  snippet: '[Fact-check summary]',
  ...e,
});

export const CLAIM_SEEDS: ClaimSeed[] = [
  {
    match: /signal no\.? ?4/i,
    text: 'PAGASA raised Signal No. 4 over Metro Manila tonight.',
    path: 'offline-match',
    verdict: 'contradicted',
    confidence: 0.91,
    reason:
      'A saved fact-check rates this claim False: the PAGASA bulletin it cites lists a lower signal for Metro Manila. Matched on-device against the bundled fact-checks.',
    evidence: [
      fc({
        publisher: 'Vera Files',
        domain: 'verafiles.org',
        title: '[Fact-check headline about the Signal No. 4 post]',
        snippet: '[Summary: the bulletin lists a lower wind signal for Metro Manila]',
        stance: 'contradicts',
        confidence: 0.91,
        date: '2026-09-28',
        claimReview: { rating: 'false', headline: '[Fact-check headline about the Signal No. 4 post]' },
      }),
    ],
    decisions: 9,
    ms: 190,
  },
  {
    match: /walang pasok|public schools/i,
    text: 'Classes in NCR public schools are suspended tomorrow.',
    path: 'offline-match',
    verdict: 'unverified',
    confidence: 0.22,
    reason: 'No known fact-check',
    evidence: [],
    decisions: 8,
    ms: 170,
    enriched: {
      text: 'Classes in NCR public schools are suspended tomorrow.',
      verdict: 'supported',
      confidence: 0.84,
      reason: 'A Tier A government source supports the claim: DepEd posted the suspension for NCR public schools. One source was off-topic and ignored.',
      evidence: [
        {
          url: 'https://www.deped.gov.ph',
          publisher: 'DepEd',
          domain: 'deped.gov.ph',
          title: '[DepEd advisory]',
          tier: 'A',
          kind: 'government',
          snippet: '[Advisory text suspending classes in NCR public schools]',
          stance: 'supports',
          confidence: 0.9,
        },
        {
          url: 'https://example.com',
          publisher: '[News outlet]',
          domain: '[outlet domain]',
          title: '[Article]',
          tier: 'B',
          kind: 'news',
          snippet: '[Article about the typhoon track — does not mention classes]',
          stance: 'unrelated',
          confidence: 0.12,
        },
      ],
      decisions: 14,
      ms: 1650,
    },
  },
  {
    match: /salabat|dengue/i,
    text: 'Drinking salabat with calamansi prevents dengue.',
    path: 'offline-match',
    verdict: 'contradicted',
    confidence: 0.87,
    reason: 'A saved fact-check rates this claim False: no food or drink prevents dengue. Matched on-device against the bundled fact-checks.',
    evidence: [
      fc({
        publisher: 'Tsek.ph',
        domain: 'tsek.ph',
        title: '[Fact-check headline about salabat and dengue]',
        snippet: '[Summary: health authorities say no drink prevents dengue]',
        stance: 'contradicts',
        confidence: 0.87,
        date: '2026-08-14',
        claimReview: { rating: 'false', headline: '[Fact-check headline about salabat and dengue]' },
      }),
    ],
    decisions: 9,
    ms: 180,
  },
  {
    match: /meralco|rebate/i,
    text: 'Meralco is giving a ₱500 rebate this month.',
    path: 'offline-match',
    verdict: 'unverified',
    confidence: 0.58,
    reason: 'Related fact-check found (post says the opposite)',
    evidence: [
      fc({
        publisher: 'Rappler',
        domain: 'rappler.com',
        title: '[Fact-check headline about a Meralco refund]',
        snippet: '[Summary of a related Meralco refund fact-check]',
        stance: 'contradicts',
        confidence: 0.58,
        date: '2026-07-02',
        claimReview: { rating: 'misleading', headline: '[Fact-check headline about a Meralco refund]' },
      }),
    ],
    decisions: 7,
    ms: 150,
  },
];

export function seedFor(sentence: string): ClaimSeed | undefined {
  return CLAIM_SEEDS.find((s) => s.match.test(sentence));
}
