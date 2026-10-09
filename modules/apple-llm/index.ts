import { requireOptionalNativeModule } from 'expo';
import type { LlmBackend } from '../../src/engine';

interface AppleLlmNative {
  availability(): { available: boolean; reason: string };
  respond(instructions: string, prompt: string, permissive: boolean): Promise<string>;
  recognizeText(uri: string): Promise<OcrLine[]>;
}

/** One OCR line; top/height/left are fractions of the image size, top measured from the top edge. */
export interface OcrLine {
  text: string;
  top: number;
  height: number;
  left: number;
}

// iOS only; null on Android (the module isn't built there).
const native = requireOptionalNativeModule<AppleLlmNative>('AppleLlm');

export function appleLlmAvailability(): { available: boolean; reason: string } {
  return native ? native.availability() : { available: false, reason: 'not available on this platform' };
}

/** LlmBackend for LlmDecisionEngine using Apple's on-device Foundation Model. */
export function appleLlmBackend({ permissive = true } = {}): LlmBackend {
  return {
    respond: (instructions, prompt) => {
      if (!native) return Promise.reject(new Error('Apple on-device model is not available on this platform'));
      return native.respond(instructions, prompt, permissive);
    },
  };
}

/** On-device OCR with Apple Vision (iOS only). */
export function recognizeTextLines(uri: string): Promise<OcrLine[]> {
  if (!native) return Promise.reject(new Error('On-device OCR is not available on this platform'));
  return native.recognizeText(uri);
}
