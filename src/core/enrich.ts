// Online enrichment source: a live Google Fact Check Tools search for one claim, normalized into Debunks with the
// same mapping as the bundled corpus (scripts/factcheck-normalize.ts). Only runs when the user asks and is online.
import { toDebunk, type ApiClaim, type ApiClaimReview, type Debunk } from '../../scripts/factcheck-normalize';

const ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

export const factcheckKey = (): string | undefined => process.env.EXPO_PUBLIC_FACTCHECK_API_KEY || undefined;

export async function searchFactchecks(query: string, key: string, signal?: AbortSignal): Promise<Debunk[]> {
  const params = new URLSearchParams({ query: query.slice(0, 400), pageSize: '20', key });
  const res = await fetch(`${ENDPOINT}?${params}`, { signal });
  if (!res.ok) throw new Error(`Fact-check search failed (${res.status})`);
  const body = (await res.json()) as { claims?: (ApiClaim & { claimReview?: ApiClaimReview[] })[] };
  const out: Debunk[] = [];
  for (const claim of body.claims ?? []) {
    for (const review of claim.claimReview ?? []) {
      const d = toDebunk(claim, review);
      if (d) out.push(d);
    }
  }
  return out;
}
