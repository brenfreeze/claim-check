// Connectivity. Stub: online unless "Simulate offline" is on (Settings → Developer).
// TODO(engine session): back with @react-native-community/netinfo and keep the simulate override for demos.
import { createStore, useStore } from './store';

const simulatedOffline = createStore(false);

export function setSimulatedOffline(on: boolean): void {
  simulatedOffline.set(on);
}

export function useSimulatedOffline(): boolean {
  return useStore(simulatedOffline);
}

export function isOnline(): boolean {
  return !simulatedOffline.get();
}

export function useIsOnline(): boolean {
  return !useStore(simulatedOffline);
}
