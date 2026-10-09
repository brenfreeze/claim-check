// Connectivity: NetInfo reachability, overridden by "Simulate offline" (Settings → Developer) for demos.
import NetInfo from '@react-native-community/netinfo';
import { createStore, useStore } from './store';

const simulatedOffline = createStore(false);
const reachable = createStore(true);

NetInfo.addEventListener((s) => reachable.set(s.isConnected === true && s.isInternetReachable !== false));

export function setSimulatedOffline(on: boolean): void {
  simulatedOffline.set(on);
}

export function useSimulatedOffline(): boolean {
  return useStore(simulatedOffline);
}

export function isOnline(): boolean {
  return reachable.get() && !simulatedOffline.get();
}

export function useIsOnline(): boolean {
  return useStore(reachable) && !useStore(simulatedOffline);
}
