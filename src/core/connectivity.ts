// Connectivity: NetInfo reachability, overridden by "Simulate offline" (Settings → Developer) for demos.
import NetInfo from '@react-native-community/netinfo';
import { createStore, useStore } from './store';

const simulatedOffline = createStore(false);
const reachable = createStore(true);

// No reachability probe: NetInfo's default pings clients3.google.com, a network call the offline path must not make.
// With the probe off NetInfo reports isInternetReachable=false forever, so only isConnected counts: connected to a
// network = online, and enrichment reports a failure if the internet isn't actually there.
NetInfo.configure({ reachabilityShouldRun: () => false });
NetInfo.addEventListener((s) => reachable.set(s.isConnected === true));

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
