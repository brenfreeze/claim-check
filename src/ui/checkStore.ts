// In-memory checks by id: starts runs, applies their events, runs Online enrichment. History is not persisted.
import { enrichClaim, runCheck } from '../core/checkPipeline';
import type { CheckEvent, CheckSource } from '../core/checkTypes';
import { isOnline } from '../core/connectivity';
import { createEngine, effectiveEngine } from '../core/engines';
import { getSettings } from '../core/settings';
import { createStore, useStore } from '../core/store';
import { initialCheck, reduceCheck, type CheckAction, type CheckState } from './checkReducer';

const store = createStore<{ checks: Record<string, CheckState>; order: string[] }>({ checks: {}, order: [] });
const runs = new Map<string, AbortController>();
let seq = 0;

function dispatch(id: string, action: CheckAction) {
  store.set((s) => {
    const cur = s.checks[id];
    return cur ? { ...s, checks: { ...s.checks, [id]: reduceCheck(cur, action) } } : s;
  });
}

export function startCheck(input: string, source: CheckSource, sentences?: string[]): string {
  const id = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  const { engine, lanUrl, gate } = getSettings();
  const check = initialCheck({ id, input, source, sentences, engine: effectiveEngine(engine, lanUrl).id, gate });
  store.set((s) => ({ checks: { ...s.checks, [id]: check }, order: [id, ...s.order] }));
  void run(id);
  return id;
}

async function run(id: string) {
  const check = store.get().checks[id];
  if (!check) return;
  const ctrl = new AbortController();
  runs.set(id, ctrl);
  try {
    const engine = await createEngine(check.engine, { lanUrl: getSettings().lanUrl });
    for await (const ev of runCheck(check.input, {
      id,
      engine,
      engineChoice: check.engine,
      gate: check.gate,
      source: check.source,
      sentences: check.sentences,
      signal: ctrl.signal,
    })) {
      if (ctrl.signal.aborted) break;
      dispatch(id, ev);
    }
  } catch (e) {
    dispatch(id, { type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    runs.delete(id);
  }
}

export function cancelCheck(id: string) {
  runs.get(id)?.abort();
  dispatch(id, { type: 'cancel' });
}

/** Re-run a failed or cancelled check as a new check; returns the new id. */
export function retryCheck(id: string): string | null {
  const c = store.get().checks[id];
  return c ? startCheck(c.input, c.source, c.sentences) : null;
}

/** Online enrichment for one claim; queues it when offline. */
export async function enrich(checkId: string, claimId: string) {
  if (!isOnline()) {
    dispatch(checkId, { type: 'enrich-queued', claimId });
    return;
  }
  const check = store.get().checks[checkId];
  if (!check?.result) return;
  try {
    const engine = await createEngine(check.engine, { lanUrl: getSettings().lanUrl });
    for await (const ev of enrichClaim(check.result, claimId, { engine, engineChoice: check.engine })) {
      if (ev.type === 'error') throw new Error(ev.message);
      dispatch(checkId, ev as CheckEvent);
    }
  } catch (e) {
    dispatch(checkId, { type: 'enrich-failed', claimId, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Run every queued enrichment (called when connectivity returns). */
export function flushQueuedEnrichments() {
  for (const check of Object.values(store.get().checks)) {
    for (const c of check.claims) if (c.enrichment?.status === 'queued') void enrich(check.id, c.id);
  }
}

export function useCheck(id: string | undefined): CheckState | undefined {
  return useStore(store, (s) => (id ? s.checks[id] : undefined));
}

export function useRecentChecks(limit = 5): CheckState[] {
  const s = useStore(store);
  return s.order.slice(0, limit).map((id) => s.checks[id]);
}
