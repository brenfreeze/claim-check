// Product-level contract between the check pipeline and the UI (spec: docs/superpowers/specs/2026-10-10-ui-mockups-design.md).
// Owned by the UI; the pipeline emits these shapes.

export type Verdict = 'supported' | 'contradicted' | 'unverified';
export type EngineChoice = 'decima-local' | 'apple-on-device' | 'lan' | 'hosted';
export type Stance = 'supports' | 'contradicts' | 'unrelated';
export type CheckSource = 'paste' | 'share' | 'screenshot';
export type FactcheckRating = 'false' | 'misleading' | 'true';
export type ClaimPath = 'offline-match' | 'live-search';

export interface EvidenceSource {
  url: string;
  publisher: string;
  domain: string;
  title: string;
  tier: 'A' | 'B' | 'C';
  kind: 'government' | 'factcheck' | 'news' | 'other';
  /** best chunk (live search) or the fact-check summary (offline match); shown highlighted */
  snippet: string;
  stance: Stance;
  /** offline match: p(supports) from ft3's 3-way framing, shown as "match confidence" */
  confidence: number;
  /** ISO date, shown on fact-check cards */
  date?: string;
  /** ClaimReview rating pill; the offline corpus uses FactcheckRating */
  claimReview?: { rating: string; headline: string };
}

export interface ClaimResult {
  id: string;
  /** normalized English */
  text: string;
  /** sentence from the post */
  original: string;
  path: ClaimPath;
  /** confidence < gate ⇒ verdict 'unverified' */
  verdict: Verdict;
  confidence: number;
  /** offline no-match: "No known fact-check"; opposite: "Related fact-check found (post says the opposite)" */
  reason: string;
  /** strongest first; an offline match is the fact-check itself (tier A, kind 'factcheck') */
  evidence: EvidenceSource[];
  stats: { engine: EngineChoice; decisions: number; ms: number; rule: string; calibration: string };
  enrichment?: { status: 'idle' | 'queued' | 'running' | 'done' | 'failed'; message?: string };
}

export interface CheckResult {
  id: string;
  input: string;
  source: CheckSource;
  /** ISO */
  createdAt: string;
  sentenceCount: number;
  gate: number;
  corpus: { count: number; syncedAt: string };
  /** false on the default (offline-match) path */
  networkUsed: boolean;
  claims: ClaimResult[];
  /** post-level writing signals; never part of a verdict */
  signals: string[];
  stats: { engine: EngineChoice; decisions: number; totalMs: number; modelLoadMs?: number };
}

/** retrieve/judge only run during online enrichment */
export type Stage = 'extract' | 'match' | 'aggregate' | 'retrieve' | 'judge';

export type CheckEvent =
  | { type: 'stage'; stage: Stage; status: 'active' | 'done'; summary?: string; meta?: string }
  | { type: 'progress'; stage: 'match' | 'judge'; done: number; total: number; avgMs: number }
  | { type: 'pending'; claims: { id: string; text: string; sources: number }[] }
  /** also replaces a claim after enrichment */
  | { type: 'claim'; claim: ClaimResult }
  | { type: 'done'; result: CheckResult }
  | { type: 'error'; message: string };

export interface EngineOption {
  id: EngineChoice;
  name: string;
  desc: string;
  latency: string;
  /** EngineBadge text, e.g. "On-device · 21 ms" */
  badge: string;
  privacy: string;
  available: boolean;
  unavailableReason?: string;
  experimental?: boolean;
}

export interface Settings {
  engine: EngineChoice;
  lanUrl: string;
  /** 0.50–0.95, step 0.05 */
  gate: number;
  compareHosted: boolean;
  factcheckSources: Record<'verafiles' | 'rappler' | 'tsek', boolean>;
  wifiOnlySync: boolean;
}

export interface OcrResult {
  sentences: { text: string; claimScore: number }[];
  ms: number;
}
