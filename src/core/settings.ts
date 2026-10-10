// App settings. In-memory for now; the engine session may persist them later.
import type { Settings } from './checkTypes';
import { createStore, useStore } from './store';

export const DEFAULT_SETTINGS: Settings = {
  engine: 'decima-local',
  lanUrl: '192.168.1.20:8000',
  // real matches score ≥ 0.97 on ft3, false ones 0.73–0.79 (src/pipeline/__tests__/*.eval.ts)
  gate: 0.85,
  compareHosted: false,
  factcheckSources: { verafiles: true, rappler: true, tsek: true },
  wifiOnlySync: true,
};

const store = createStore<Settings>(DEFAULT_SETTINGS);

export const getSettings = store.get;

export function setSettings(patch: Partial<Settings>): void {
  store.set((s) => ({ ...s, ...patch }));
}

export function useSettings(): Settings {
  return useStore(store);
}
