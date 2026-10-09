// Builds the bundled offline corpus from the Google Fact Check Tools API.
//   node --experimental-strip-types scripts/pull-factchecks.ts
// Requires FACTCHECK_API_KEY in .env.local (git-ignored) or the environment. Network use is build-time only;
// the app itself never calls this API.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { toDebunk, type ApiClaim, type Debunk } from './factcheck-normalize.ts';

// PH topic queries, mixing hazard/weather, government services and politics — the kinds of claims that
// circulate on PH social media.
const QUERIES = [
  'class suspension',
  'walang pasok',
  'suspendido ang klase',
  'ayuda',
  'PAGASA',
  'signal no',
  'bagyo',
  'typhoon',
  'evacuation',
  'DOH',
  'SSS',
  'GSIS',
  '4Ps',
  'Comelec',
  'Marcos',
  'Duterte',
  'vaccine',
  'bakuna',
  'West Philippine Sea',
  'ROTC',
  'PhilHealth',
  'DepEd',
  'CHED',
  'MMDA',
  'LTO',
  'Meralco',
  'price rollback',
  'sweldo',
  'holiday',
];

const PUBLISHERS = [
  'verafiles.org',
  'rappler.com',
  'tsek.ph',
  'news.abs-cbn.com',
  'factsfirst.ph',
  'pna.gov.ph',
  'factcheck.afp.com',
  'newsinfo.inquirer.net',
];

const LANGS = ['en', 'tl'];

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const SLEEP_MS = 150;
const RETRY_DELAY_MS = 2000;
const API_URL = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

// The file is loaded as an ES module (an `import` is present), where `__dirname` doesn't exist.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'assets/corpus');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readApiKey(): string {
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    const line = fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith('FACTCHECK_API_KEY='));
    if (line) {
      const value = line.slice(line.indexOf('=') + 1).trim();
      if (value) return value;
    }
  }
  if (process.env.FACTCHECK_API_KEY) return process.env.FACTCHECK_API_KEY;
  throw new Error('FACTCHECK_API_KEY not found. Add it to .env.local (git-ignored) or set it in the environment.');
}

function redact(url: string): string {
  return url.replace(/key=[^&]+/, 'key=REDACTED');
}

interface SearchResponse {
  claims?: ApiClaim[];
  nextPageToken?: string;
}

async function fetchPage(
  apiKey: string,
  query: string,
  site: string,
  languageCode: string | undefined,
  pageToken: string | undefined,
): Promise<SearchResponse> {
  const url = new URL(API_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('reviewPublisherSiteFilter', site);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  if (languageCode) url.searchParams.set('languageCode', languageCode);
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  url.searchParams.set('key', apiKey);

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString());
    } catch (err) {
      if (attempt === 0) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw new Error(`fetch failed for ${redact(url.toString())}: ${(err as Error).message}`);
    }
    if (res.ok) return (await res.json()) as SearchResponse;
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new Error(`fetch failed (${res.status}) for ${redact(url.toString())}`);
  }
  throw new Error('unreachable');
}

/**
 * Pulls one query × publisher combo. Always makes one call without `languageCode`; makes one probe call per
 * `LANGS` value, and only keeps paginating a language-filtered call past its first page when that first page
 * actually added a URL the base call (or an earlier lang call) hadn't already found.
 */
async function fetchCombo(
  apiKey: string,
  query: string,
  site: string,
): Promise<{ debunks: Map<string, Debunk>; unmapped: Map<string, number> }> {
  const debunks = new Map<string, Debunk>();
  const unmapped = new Map<string, number>();

  async function runPasses(languageCode: string | undefined): Promise<void> {
    let pageToken: string | undefined;
    let page = 0;
    do {
      const data = await fetchPage(apiKey, query, site, languageCode, pageToken);
      page++;
      let addedThisPage = false;
      for (const claim of data.claims ?? []) {
        for (const review of claim.claimReview ?? []) {
          const debunk = toDebunk(claim, review);
          if (!debunk) {
            const key = review.textualRating.toLowerCase();
            unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
            continue;
          }
          if (!debunks.has(debunk.url)) {
            debunks.set(debunk.url, debunk);
            addedThisPage = true;
          }
        }
      }
      pageToken = data.nextPageToken;
      // Lang-filtered pass adding nothing new on its first page is almost certainly a subset of the base
      // pass's results — stop paginating it rather than spending calls confirming that.
      if (languageCode && page === 1 && !addedThisPage) pageToken = undefined;
      if (pageToken) await sleep(SLEEP_MS);
    } while (pageToken && page < MAX_PAGES);
  }

  await runPasses(undefined);
  for (const lang of LANGS) {
    await sleep(SLEEP_MS);
    await runPasses(lang);
  }

  return { debunks, unmapped };
}

async function main(): Promise<void> {
  const apiKey = readApiKey();

  const allDebunks = new Map<string, Debunk>();
  const allUnmapped = new Map<string, number>();

  for (const query of QUERIES) {
    for (const site of PUBLISHERS) {
      const { debunks, unmapped } = await fetchCombo(apiKey, query, site);
      for (const [url, d] of debunks) allDebunks.set(url, d);
      for (const [rating, n] of unmapped) allUnmapped.set(rating, (allUnmapped.get(rating) ?? 0) + n);
      console.log(`${query} × ${site}: ${debunks.size}`);
      await sleep(SLEEP_MS);
    }
  }

  if (allUnmapped.size > 0) {
    console.log('\nUnmapped ratings:');
    for (const [rating, n] of [...allUnmapped.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  "${rating}": ${n}`);
    }
  }

  const sorted = [...allDebunks.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const perPublisher: Record<string, number> = {};
  const perRating: Record<string, number> = {};
  for (const d of sorted) {
    perPublisher[d.publisher] = (perPublisher[d.publisher] ?? 0) + 1;
    perRating[d.rating] = (perRating[d.rating] ?? 0) + 1;
  }

  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  fs.writeFileSync(path.join(CORPUS_DIR, 'debunks.json'), JSON.stringify(sorted, null, 2) + '\n');

  const meta = {
    builtAt: new Date().toISOString(),
    count: sorted.length,
    perPublisher,
    perRating,
  };
  fs.writeFileSync(path.join(CORPUS_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const overridesPath = path.join(CORPUS_DIR, 'demo-overrides.json');
  if (!fs.existsSync(overridesPath)) {
    const placeholders = [1, 2, 3].map((n) => ({
      id: `REPLACE_ME_${n}`,
      aliases: ['<Taglish paraphrase>'],
    }));
    fs.writeFileSync(overridesPath, JSON.stringify(placeholders, null, 2) + '\n');
  }

  console.log('\nSummary:');
  console.log(`  total: ${sorted.length}`);
  console.log(`  per publisher: ${JSON.stringify(perPublisher)}`);
  console.log(`  per rating: ${JSON.stringify(perRating)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
