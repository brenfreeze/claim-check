// Pipeline stepper (Analyzing), writing signals, offline banner, engine radio option (Settings).
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { EngineOption as EngineOptionData } from '../../core/checkTypes';
import type { StepState } from '../checkReducer';
import { CheckIcon, WifiOffIcon } from '../icons';
import { color, font, radius } from '../tokens';
import { Meta } from './primitives';

export interface StepperStep extends StepState {
  title: string;
  /** shown under the title while pending/active when the stage has no summary yet */
  description: string;
  progress?: { done: number; total: number; avgMs: number };
}

/** done (ink check) / active (blue ring, progress bar) / pending (outlined). */
export function PipelineStepper({ steps }: { steps: StepperStep[] }) {
  return (
    <View>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const nextStarted = !last && steps[i + 1].status !== 'pending';
        const active = s.status === 'active';
        const pending = s.status === 'pending';
        return (
          <View key={s.title} style={styles.step} accessible accessibilityLabel={`${s.title}: ${s.status}. ${s.summary ?? s.description}`}>
            <View style={styles.rail}>
              {s.status === 'done' ? (
                <View style={styles.doneDot}>
                  <CheckIcon size={14} color="#FFFFFF" strokeWidth={2.25} />
                </View>
              ) : active ? (
                <View style={styles.activeDot}>
                  <View style={styles.activeInner} />
                </View>
              ) : (
                <View style={styles.pendingDot} />
              )}
              {!last ? <View style={[styles.line, { backgroundColor: s.status === 'done' && nextStarted ? color.ink : color.borderStrong }]} /> : null}
            </View>
            <View style={[styles.stepBody, !last && { paddingBottom: 18 }, { gap: active ? 6 : 3 }]}>
              <Text style={[styles.stepTitle, active && { color: color.link }, pending && { color: color.inkFaint }]}>{s.title}</Text>
              <Text style={[styles.stepText, pending && { color: color.inkFaint }]}>{s.summary ?? s.description}</Text>
              {active && s.progress ? (
                <>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round((s.progress.done / Math.max(1, s.progress.total)) * 100)}%` }]} />
                  </View>
                  <Meta>
                    {s.progress.done} of {s.progress.total} decisions · avg {s.progress.avgMs} ms
                  </Meta>
                </>
              ) : s.meta ? (
                <Meta>{s.meta}</Meta>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function SignalsPanel({ signals }: { signals: string[] }) {
  if (!signals.length) return null;
  return (
    <View style={styles.signals}>
      <View style={styles.signalsHead}>
        <Text style={styles.signalsLabel}>Writing signals</Text>
        <Text style={styles.signalsNote}>Not part of any verdict</Text>
      </View>
      <View style={styles.signalsWrap}>
        {signals.map((s) => (
          <View key={s} style={styles.signal}>
            <Text style={styles.signalText}>{s}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function OfflineBanner({ count, synced }: { count: number; synced: string }) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <WifiOffIcon size={22} color={color.onInk} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.bannerTitle}>You're offline</Text>
        <Text style={styles.bannerText}>
          Checked against {count.toLocaleString('en-US')} saved fact-checks from Vera Files, Rappler and Tsek.ph. Synced {synced}.
        </Text>
      </View>
    </View>
  );
}

export function EngineOptionRow({ option, selected, onSelect }: { option: EngineOptionData; selected: boolean; onSelect: () => void }) {
  const disabled = !option.available;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      style={[styles.option, selected ? styles.optionSelected : styles.optionIdle, disabled && { opacity: 0.55 }]}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={styles.optionName}>{option.name}</Text>
          {option.experimental ? (
            <View style={styles.experimental}>
              <Text style={styles.experimentalText}>Experimental</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.optionDesc}>{disabled && option.unavailableReason ? option.unavailableReason : option.desc}</Text>
      </View>
      <Text style={styles.optionLatency}>{option.latency}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: 14 },
  rail: { width: 26, alignItems: 'center' },
  doneDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  activeDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: color.link, alignItems: 'center', justifyContent: 'center' },
  activeInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.link },
  pendingDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: color.borderStrong },
  line: { flex: 1, width: 2, minHeight: 18 },
  stepBody: { flex: 1 },
  stepTitle: { fontFamily: font.bodySemibold, fontSize: 15, color: color.ink },
  stepText: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: color.inkSecondary },
  progressTrack: { height: 6, borderRadius: radius.chip, backgroundColor: color.border, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: color.link },
  signals: { gap: 10, padding: 14, borderRadius: radius.card, backgroundColor: color.surfaceMuted },
  signalsHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  signalsLabel: { fontFamily: font.bodySemibold, fontSize: 12, letterSpacing: 0.72, textTransform: 'uppercase', color: color.inkSecondary },
  signalsNote: { fontFamily: font.body, fontSize: 12, color: color.inkMuted },
  signalsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  signal: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderPanel },
  signalText: { fontFamily: font.body, fontSize: 13, color: color.ink },
  banner: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: radius.input, backgroundColor: color.ink },
  bannerTitle: { fontFamily: font.bodySemibold, fontSize: 15, color: color.onInk },
  bannerText: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.onInkMuted },
  option: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: radius.input, backgroundColor: color.surface },
  optionSelected: { borderWidth: 2, borderColor: color.ink },
  optionIdle: { borderWidth: 1, borderColor: color.border, margin: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: color.inkDisabled, marginTop: 2, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: color.ink, borderWidth: 2 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.ink },
  optionName: { fontFamily: font.bodySemibold, fontSize: 15, color: color.ink },
  optionDesc: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: color.inkSecondary },
  optionLatency: { fontFamily: font.mono, fontSize: 11.5, color: color.inkSecondary, paddingTop: 3 },
  experimental: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.tag, borderWidth: 1, borderColor: color.borderStrong },
  experimentalText: { fontFamily: font.mono, fontSize: 10.5, color: color.inkMuted },
});
