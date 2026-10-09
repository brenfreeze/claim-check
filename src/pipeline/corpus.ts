// The bundled corpus of PH fact-checks (assets/corpus/, built by scripts/pull-factchecks.ts) plus the hand-edited
// demo overrides merged on top.
import type { Debunk } from '../../scripts/factcheck-normalize';

export type { Debunk } from '../../scripts/factcheck-normalize';

export type DemoOverride = { id: string; aliases?: string[]; claim?: string; rating?: Debunk['rating']; summary?: string };

/** An override with a matching id replaces its fields and appends its aliases; unknown ids are ignored. */
export function mergeCorpus(base: Debunk[], overrides: DemoOverride[]): Debunk[] {
  const byId = new Map(overrides.map((o) => [o.id, o]));
  return base.map((d) => {
    const o = byId.get(d.id);
    if (!o) return d;
    const { aliases, ...fields } = o;
    const merged = { ...d, ...fields };
    return aliases?.length ? { ...merged, aliases: [...(d.aliases ?? []), ...aliases] } : merged;
  });
}

export function loadBundledCorpus(): { debunks: Debunk[]; builtAt: string } {
  const base: Debunk[] = require('../../assets/corpus/debunks.json');
  const overrides: DemoOverride[] = require('../../assets/corpus/demo-overrides.json');
  const meta: { builtAt: string } = require('../../assets/corpus/meta.json');
  return { debunks: mergeCorpus(base, overrides), builtAt: meta.builtAt };
}
