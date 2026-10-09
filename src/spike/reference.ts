// Which model the spike runs against: EXPO_PUBLIC_MODEL_VARIANT=ft3 → the ft3 fine-tune (its own storage folder and
// parity reference); anything else → the shipped Decima-small int8. Both references are bundled (~0.3 MB each).
import baseReference from '../../fixtures/phase0.reference.json';
import ft3Reference from '../../fixtures/phase0.reference.ft3.json';

export const MODEL_VARIANT = process.env.EXPO_PUBLIC_MODEL_VARIANT === 'ft3' ? 'ft3' : 'base';
export const reference: typeof baseReference = MODEL_VARIANT === 'ft3' ? ft3Reference : baseReference;
