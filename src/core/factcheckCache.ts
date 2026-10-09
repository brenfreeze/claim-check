// Bundled corpus of PH fact-checks. Mock until the engine session wires src/pipeline/matchOffline.ts.
import type { EvidenceSource } from './checkTypes';

const MOCK_SYNCED_AT = new Date(Date.now() - 2 * 3600_000).toISOString();

export function corpusInfo(): { count: number; syncedAt: string } {
  return { count: 1284, syncedAt: MOCK_SYNCED_AT };
}

export async function matchCached(_claim: string): Promise<EvidenceSource[]> {
  return [];
}
