// Decision-engine choices for Settings and the factory the pipeline uses. createEngine is a mock until the
// engine session wires OnDeviceDecimaEngine / LlmDecisionEngine(appleLlmBackend) / the HTTP engine.
import { Platform } from 'react-native';
import { appleLlmAvailability } from '../../modules/apple-llm';
import type { DecisionEngine } from '../engine/types';
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
export function effectiveEngine(choice: EngineChoice, lanUrl: string): EngineOption {
  const options = engineOptions(lanUrl);
  const picked = options.find((o) => o.id === choice);
  return picked && picked.available ? picked : options[0];
}

export async function createEngine(choice: EngineChoice, _cfg?: { lanUrl?: string }): Promise<DecisionEngine> {
  const id = choice === 'decima-local' ? 'decima-local' : choice === 'apple-on-device' ? 'apple-on-device' : 'http';
  return {
    id,
    systemOne: async () => {
      throw new Error('mock engine: systemOne is wired by the engine session');
    },
  };
}
