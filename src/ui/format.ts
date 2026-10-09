// Pure view helpers (unit-tested in Node).
import type { ClaimResult, EngineChoice, EvidenceSource, Verdict } from '../core/checkTypes';

export const VERDICT_LABEL: Record<Verdict, string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  unverified: 'Unverified',
};

export function verdictTotals(claims: Pick<ClaimResult, 'verdict'>[]): Record<Verdict, number> {
  const t: Record<Verdict, number> = { contradicted: 0, supported: 0, unverified: 0 };
  for (const c of claims) t[c.verdict]++;
  return t;
}

export const score = (x: number) => x.toFixed(2);

/** "0.91", or "0.58 · below 0.70" for an Unverified claim under the gate. */
export function confidenceLabel(claim: Pick<ClaimResult, 'verdict' | 'confidence'>, gate: number): string {
  return claim.verdict === 'unverified' && claim.confidence < gate
    ? `${score(claim.confidence)} · below ${score(gate)}`
    : score(claim.confidence);
}

/** "PAGASA · Vera Files · +1": up to two related publishers, then a count. */
export function sourceSummary(evidence: Pick<EvidenceSource, 'publisher' | 'stance'>[], max = 2): string {
  const related = evidence.filter((e) => e.stance !== 'unrelated');
  const names = related.slice(0, max).map((e) => e.publisher);
  const rest = evidence.length - names.length;
  return rest > 0 ? `${names.join(' · ')} · +${rest}` : names.join(' · ');
}

/** "just now", "5 min ago", "2h ago", "Yesterday", "3 days ago". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2 * 86400) return 'Yesterday';
  return `${Math.floor(s / 86400)} days ago`;
}

/** "Sep 28, 2026" */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function corpusLine(corpus: { count: number; syncedAt: string }, now?: Date): string {
  return `Checked on-device against ${corpus.count.toLocaleString('en-US')} saved fact-checks · synced ${relativeTime(corpus.syncedAt, now)}`;
}

export function ratingLabel(rating: string): string {
  return rating.charAt(0).toUpperCase() + rating.slice(1);
}

/** Rating pills: false/misleading read as contradicting (orange), true as supporting (blue). */
export function ratingVerdict(rating: string): Verdict {
  const r = rating.toLowerCase();
  if (r === 'true' || r === 'correct' || r === 'accurate') return 'supported';
  if (r === 'false' || r === 'misleading' || r.includes('false') || r.includes('mislead')) return 'contradicted';
  return 'unverified';
}

export const KIND_LABEL: Record<EvidenceSource['kind'], string> = {
  government: 'Gov',
  factcheck: 'Fact-checker',
  news: 'News',
  other: 'Other',
};

export const STANCE_LABEL: Record<EvidenceSource['stance'], string> = {
  supports: 'Supports',
  contradicts: 'Contradicts',
  unrelated: 'Unrelated · ignored',
};

export const ENGINE_SHORT: Record<EngineChoice, string> = {
  'decima-local': 'decima-small · on-device',
  'apple-on-device': 'apple-fm · on-device',
  lan: 'decima-small · laptop',
  hosted: 'jev · hosted',
};

export const ENGINE_NAME: Record<EngineChoice, string> = {
  'decima-local': 'Decima-small on-device',
  'apple-on-device': 'Apple on-device',
  lan: 'Decima-small on laptop',
  hosted: 'Hosted Jev',
};

export function seconds(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Recent-check row meta: "Yesterday · 2 contradicted · 1 unverified". */
export function recentMeta(createdAt: string, claims: Pick<ClaimResult, 'verdict' | 'enrichment'>[], running: boolean, now?: Date): string {
  if (running) return `${relativeTime(createdAt, now)} · checking…`;
  const t = verdictTotals(claims);
  const queued = claims.filter((c) => c.enrichment?.status === 'queued').length;
  const parts = [relativeTime(createdAt, now)];
  if (t.contradicted) parts.push(`${t.contradicted} contradicted`);
  if (t.supported) parts.push(`${t.supported} supported`);
  if (t.unverified) parts.push(`${t.unverified} unverified`);
  if (queued) parts.push(`${queued} queued`);
  return parts.join(' · ');
}

export const SOURCE_LABEL = { paste: 'Pasted text', share: 'Shared post', screenshot: 'Screenshot' } as const;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
