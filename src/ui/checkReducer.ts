// Pure state for one check, built from the CheckEvent stream (no React, no native imports: unit-tested in Node).
import type { CheckEvent, CheckResult, CheckSource, ClaimResult, EngineChoice, Stage } from '../core/checkTypes';

export type StepStatus = 'pending' | 'active' | 'done';
export interface StepState {
  status: StepStatus;
  summary?: string;
  meta?: string;
}

export interface CheckState {
  id: string;
  input: string;
  source: CheckSource;
  sentences?: string[];
  engine: EngineChoice;
  gate: number;
  createdAt: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  steps: Record<'extract' | 'match' | 'aggregate', StepState>;
  progress?: { done: number; total: number; avgMs: number };
  pending: { id: string; text: string; sources: number }[];
  claims: ClaimResult[];
  result?: CheckResult;
  error?: string;
}

export type CheckAction =
  | CheckEvent
  | { type: 'cancel' }
  | { type: 'enrich-queued'; claimId: string }
  | { type: 'enrich-failed'; claimId: string; message: string };

export function initialCheck(init: Pick<CheckState, 'id' | 'input' | 'source' | 'sentences' | 'engine' | 'gate'> & { createdAt?: string }): CheckState {
  return {
    ...init,
    createdAt: init.createdAt ?? new Date().toISOString(),
    status: 'running',
    steps: { extract: { status: 'pending' }, match: { status: 'pending' }, aggregate: { status: 'pending' } },
    pending: [],
    claims: [],
  };
}

const PIPELINE_STEPS: Stage[] = ['extract', 'match', 'aggregate'];

export function reduceCheck(s: CheckState, a: CheckAction): CheckState {
  switch (a.type) {
    case 'stage': {
      if (!PIPELINE_STEPS.includes(a.stage)) return s; // enrichment stages are shown on the claim, not the stepper
      const key = a.stage as keyof CheckState['steps'];
      const prev = s.steps[key];
      return {
        ...s,
        steps: { ...s.steps, [key]: { status: a.status, summary: a.summary ?? prev.summary, meta: a.meta ?? prev.meta } },
      };
    }
    case 'progress':
      return a.stage === 'match' ? { ...s, progress: { done: a.done, total: a.total, avgMs: a.avgMs } } : s;
    case 'pending':
      return { ...s, pending: a.claims };
    case 'claim':
      return withClaim(s, a.claim);
    case 'done':
      // keep claims already enriched while the stream was finishing
      return { ...s, status: 'done', claims: a.result.claims, result: a.result, pending: [] };
    case 'error':
      return { ...s, status: 'error', error: a.message };
    case 'cancel':
      return s.status === 'running' ? { ...s, status: 'cancelled' } : s;
    case 'enrich-queued':
      return patchClaim(s, a.claimId, { enrichment: { status: 'queued' } });
    case 'enrich-failed':
      return patchClaim(s, a.claimId, { enrichment: { status: 'failed', message: a.message } });
  }
}

function withClaim(s: CheckState, claim: ClaimResult): CheckState {
  const exists = s.claims.some((c) => c.id === claim.id);
  const claims = exists ? s.claims.map((c) => (c.id === claim.id ? claim : c)) : [...s.claims, claim];
  const result = s.result && {
    ...s.result,
    claims: s.result.claims.map((c) => (c.id === claim.id ? claim : c)),
    networkUsed: s.result.networkUsed || claim.path === 'live-search',
  };
  return { ...s, claims, result };
}

function patchClaim(s: CheckState, claimId: string, patch: Partial<ClaimResult>): CheckState {
  const c = s.claims.find((x) => x.id === claimId);
  return c ? withClaim(s, { ...c, ...patch }) : s;
}

/** Claims still being matched (pending rows without a result yet). */
export function stillPending(s: CheckState): CheckState['pending'] {
  const done = new Set(s.claims.map((c) => c.id));
  return s.pending.filter((p) => !done.has(p.id));
}
