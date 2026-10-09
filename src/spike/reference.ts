// Which model the app and the spike run against: the ft3 fine-tune by default (its own storage folder and parity
// reference); EXPO_PUBLIC_MODEL_VARIANT=base → the shipped Decima-small int8. Both references are bundled (~0.3 MB each).
import baseReference from '../../fixtures/phase0.reference.json';
import ft3Reference from '../../fixtures/phase0.reference.ft3.json';

export const MODEL_VARIANT = process.env.EXPO_PUBLIC_MODEL_VARIANT === 'base' ? 'base' : 'ft3';
export const reference: typeof baseReference = MODEL_VARIANT === 'ft3' ? ft3Reference : baseReference;
