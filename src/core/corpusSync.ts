// Manual sync (Settings → Sync now): fetch fact-checks published since the last sync from the Google Fact Check
// Tools API, keep them in app storage, and merge them into the matcher. Never runs during a check.
import NetInfo from '@react-native-community/netinfo';
import { File, Paths } from 'expo-file-system';
import { toDebunk, type ApiClaim, type Debunk } from '../../scripts/factcheck-normalize';
import { isOnline } from './connectivity';
import { factcheckKey } from './enrich';
import { corpusInfo, setSyncedCorpus } from './factcheckCache';
import { getSettings } from './settings';

const ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';
const MAX_PAGES = 10;
const SITES: { site: string; enabled: () => boolean }[] = [
  { site: 'rappler.com', enabled: () => getSettings().factcheckSources.rappler },
  { site: 'verafiles.org', enabled: () => getSettings().factcheckSources.verafiles },
  { site: 'tsek.ph', enabled: () => getSettings().factcheckSources.tsek },
  { site: 'factcheck.afp.com', enabled: () => true },
];

type Stored = { syncedAt: string; debunks: Debunk[] };
const storeFile = () => new File(Paths.document, 'factchecks-synced.json');

/** At app start: merge what earlier syncs saved on this phone. */
export async function loadSyncedCorpus(): Promise<void> {
  const f = storeFile();
  if (!f.exists) return;
  try {
    const stored = JSON.parse(await f.text()) as Stored;
    setSyncedCorpus(stored.debunks, stored.syncedAt);
  } catch {
    // a corrupt file only costs the synced extras; the bundled corpus still works
  }
}

export async function syncFactchecks(): Promise<{ added: number; total: number }> {
  if (!isOnline()) throw new Error('You’re offline. Connect to sync.');
  const key = factcheckKey();
  if (!key) throw new Error('No fact-check search key configured');
  if (getSettings().wifiOnlySync && (await NetInfo.fetch()).type !== 'wifi') {
    throw new Error('Connect to Wi-Fi, or turn off “Sync on Wi-Fi only”.');
  }

  const since = Date.parse(corpusInfo().syncedAt);
  const days = Math.min(365, Math.max(1, Math.ceil((Date.now() - since) / 86_400_000) + 1));
  const f = storeFile();
  const previous: Debunk[] = f.exists ? (JSON.parse(await f.text()) as Stored).debunks : [];
  const byUrl = new Map(previous.map((d) => [d.url, d]));
  const before = corpusInfo().count;

  for (const { site, enabled } of SITES) {
    if (!enabled()) continue;
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ reviewPublisherSiteFilter: site, maxAgeDays: String(days), pageSize: '100', key });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`${ENDPOINT}?${params}`);
      if (!res.ok) throw new Error(`Fact-check sync failed (${res.status})`);
      const body = (await res.json()) as { claims?: ApiClaim[]; nextPageToken?: string };
      for (const claim of body.claims ?? []) {
        for (const review of claim.claimReview ?? []) {
          const d = toDebunk(claim, review);
          if (d) byUrl.set(d.url, d);
        }
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
  }

  const stored: Stored = { syncedAt: new Date().toISOString(), debunks: [...byUrl.values()] };
  if (!f.exists) f.create();
  f.write(JSON.stringify(stored));
  setSyncedCorpus(stored.debunks, stored.syncedAt);
  const total = corpusInfo().count;
  return { added: total - before, total };
}
