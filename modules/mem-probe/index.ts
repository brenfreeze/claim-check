import { requireNativeModule } from 'expo';

export interface MemSnapshot {
  /** Android VmRSS; iOS phys_footprint */
  rssMb: number;
  /** Android VmHWM (resettable); iOS phys_footprint peak */
  peakRssMb: number;
  /** Android total PSS; iOS resident size */
  pssMb: number;
  nativeHeapMb: number;
  deviceTotalMb: number;
}

const MemProbe = requireNativeModule<{ snapshot(): MemSnapshot; resetPeak(): boolean }>('MemProbe');

export const memSnapshot = (): MemSnapshot => MemProbe.snapshot();
/** Resets the peak counter where the OS allows it (Android). Returns false where it can't. */
export const resetMemPeak = (): boolean => MemProbe.resetPeak();
