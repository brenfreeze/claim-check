// Decision-engine choices for Settings and the factory the pipeline uses. On-device Decima (ft3) and the Apple
// on-device model are real; the LAN and hosted engines are still mocks (the HTTP engine isn't built).
import * as ort from 'onnxruntime-react-native';
import { Platform } from 'react-native';
import { appleLlmAvailability, appleLlmBackend } from '../../modules/apple-llm';
import { LlmDecisionEngine, OnDeviceDecimaEngine } from '../engine';
import type { DecisionEngine } from '../engine/types';
import { FACT_CHECK_INSTRUCTIONS } from '../spike/llmProtocol';
import { modelDir, modelPresent, readText, sessionPath } from '../spike/modelStore';
import type { EngineChoice, EngineOption } from './checkTypes';

const ON_DEVICE_PRIVACY = 'Your text never leaves this phone. Every match and judgment runs on-device.';

export function engineOptions(lanUrl: string): EngineOption[] {
  const apple = Platform.OS === 'ios' ? appleLlmAvailability() : { available: false, reason: '' };
  return [
    {
      id: 'decima-local',
      name: 'On this phone',
      desc: 'Decima-small · works offline · nothing leaves the device',
      latency: '21 ms',
      badge: 'On-device · Decima-small · 21 ms',
      privacy: ON_DEVICE_PRIVACY,
      available: true,
    },
    {
      id: 'apple-on-device',
      name: 'On this phone · Apple Intelligence',
      desc: 'Apple on-device model · iOS 26+ · nothing leaves the device',
      latency: '~0.9 s',
      badge: 'Apple · on-device · ~0.9 s',
      privacy: ON_DEVICE_PRIVACY,
      available: apple.available,
      unavailableReason: apple.available ? undefined : 'Needs iOS 26 + Apple Intelligence',
      experimental: true,
    },
    {
      id: 'lan',
      name: 'Laptop on local Wi-Fi',
      desc: `Decima serve at ${lanUrl} · still local AI`,
      latency: '38 ms',
      badge: 'Laptop · 38 ms',
      privacy: 'Claims and evidence go to your laptop on this network. Nothing reaches a cloud AI.',
      available: true,
    },
    {
      id: 'hosted',
      name: 'Hosted Jev',
      desc: 'Accuracy reference · needs internet',
      latency: '410 ms',
      badge: 'Hosted · 410 ms',
      privacy: 'Claims and evidence are sent to the hosted Jev API for judging.',
      available: true,
    },
  ];
}

/** The option a check actually runs on: the saved choice, or Decima when that is unavailable here. */
/** Only on-device Decima runs checks for now: the Apple model errors on multi-sentence posts, LAN/hosted aren't built. */
const DECIMA_ONLY = true;

export function effectiveEngine(choice: EngineChoice, lanUrl: string): EngineOption {
  const options = engineOptions(lanUrl);
  const picked = options.find((o) => o.id === choice);
  return picked && picked.available && !DECIMA_ONLY ? picked : options[0];
}

const THREADS = Number(process.env.EXPO_PUBLIC_THREADS) || 2;
let decima: Promise<OnDeviceDecimaEngine> | null = null;

/** Loads Decima once per app run from the model files the spike downloaded to the phone. */
function loadDecima(): Promise<OnDeviceDecimaEngine> {
  if (!modelPresent()) throw new Error('Model not on device — open Settings → Developer → Phase 0 spike to download');
  decima ??= OnDeviceDecimaEngine.load({
    ort,
    modelDir: modelDir().uri,
    readText,
    sessionPath,
    sessionOptions: { intraOpNumThreads: THREADS, interOpNumThreads: 1, graphOptimizationLevel: 'all', executionProviders: ['cpu'] },
  }).catch((e) => {
    decima = null;
    throw e;
  });
  return decima;
}

export async function createEngine(choice: EngineChoice, _cfg?: { lanUrl?: string }): Promise<DecisionEngine> {
  if (choice === 'decima-local') return loadDecima();
  if (choice === 'apple-on-device') {
    return new LlmDecisionEngine({ backend: appleLlmBackend({ permissive: true }), domainInstructions: FACT_CHECK_INSTRUCTIONS });
  }
  return {
    id: 'http',
    systemOne: async () => {
      throw new Error('mock engine: systemOne is wired by the engine session');
    },
  };
}
