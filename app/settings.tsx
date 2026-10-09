import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { setSimulatedOffline, useSimulatedOffline } from '../src/core/connectivity';
import { engineOptions } from '../src/core/engines';
import { corpusInfo } from '../src/core/factcheckCache';
import { setSettings, useSettings } from '../src/core/settings';
import type { Settings } from '../src/core/checkTypes';
import { EngineOptionRow } from '../src/ui/components/panels';
import { Meta, Screen, ScreenHeader, SectionLabel } from '../src/ui/components/primitives';
import { EngineBadge } from '../src/ui/components/verdict';
import { relativeTime } from '../src/ui/format';
import { ChevronRight, ShieldIcon } from '../src/ui/icons';
import { color, font, radius } from '../src/ui/tokens';

// Hidden for now: only on-device Decima runs checks (the Apple model fails on multi-sentence inputs; LAN/hosted
// engines aren't built). The picker and its options stay in code for when they are.
const SHOW_ENGINE_PICKER = false;

const SOURCES: { key: keyof Settings['factcheckSources']; label: string }[] = [
  { key: 'verafiles', label: 'Vera Files' },
  { key: 'rappler', label: 'Rappler' },
  { key: 'tsek', label: 'Tsek.ph' },
];

export default function SettingsScreen() {
  const s = useSettings();
  const simulatedOffline = useSimulatedOffline();
  const options = engineOptions(s.lanUrl);
  const saved = options.find((o) => o.id === s.engine)!;
  const current = saved.available ? saved : options[0];
  const corpus = corpusInfo();
  const [gate, setGate] = useState(s.gate);
  const [synced, setSynced] = useState(false);

  return (
    <Screen gap={22}>
      <ScreenHeader title="Settings" right={<EngineBadge label={shortBadge(current.badge)} icon={false} />} />

      {SHOW_ENGINE_PICKER ? (
        <View style={{ gap: 10 }}>
          <SectionLabel>Decision engine</SectionLabel>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            {options.map((o) => (
              <EngineOptionRow key={o.id} option={o} selected={o.id === current.id} onSelect={() => setSettings({ engine: o.id })} />
            ))}
          </View>
          {!saved.available ? (
            <Text style={styles.note}>
              {saved.name} isn't available here ({saved.unavailableReason}). Checks use {current.name}.
            </Text>
        ) : null}
        <ToggleRow label="Compare with hosted Jev side by side" value={s.compareHosted} onChange={(v) => setSettings({ compareHosted: v })} bare />
      </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionLabel>On-device model</SectionLabel>
        <View style={styles.panel}>
          <View style={styles.rowBetween}>
            <View style={{ gap: 2 }}>
              <Text style={styles.mono}>decima-small · int8</Text>
              <Text style={styles.small}>140 MB · Downloaded</Text>
            </View>
            <SmallButton label="Re-download" onPress={() => {}} />
          </View>
          <View style={styles.fullBar} />
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Verdict threshold</SectionLabel>
        <View style={[styles.panel, { gap: 8 }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Mark Unverified below</Text>
            <Text style={[styles.mono, { fontFamily: font.monoMedium }]}>{gate.toFixed(2)}</Text>
          </View>
          <Slider
            accessibilityLabel="Verdict threshold"
            minimumValue={0.5}
            maximumValue={0.95}
            step={0.05}
            value={s.gate}
            onValueChange={(v) => setGate(Math.round(v * 100) / 100)}
            onSlidingComplete={(v) => setSettings({ gate: Math.round(v * 100) / 100 })}
            minimumTrackTintColor={color.ink}
            maximumTrackTintColor={color.border}
            thumbTintColor={color.ink}
          />
          <Text style={styles.small}>
            Higher means fewer verdicts, but each one is more reliable. Scores are calibrated on Filipino and Taglish examples.
          </Text>
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Offline fact-checks</SectionLabel>
        <View style={styles.group}>
          <View style={[styles.rowBetween, styles.groupRow, styles.divider]}>
            <View style={{ gap: 2 }}>
              <Text style={[styles.label, { fontFamily: font.bodyMedium }]}>{corpus.count.toLocaleString('en-US')} saved</Text>
              <Meta>last sync {synced ? 'just now' : relativeTime(corpus.syncedAt)}</Meta>
            </View>
            <SmallButton label="Sync now" primary onPress={() => setSynced(true)} />
          </View>
          {SOURCES.map((src) => (
            <ToggleRow
              key={src.key}
              label={src.label}
              value={s.factcheckSources[src.key]}
              onChange={(v) => setSettings({ factcheckSources: { ...s.factcheckSources, [src.key]: v } })}
            />
          ))}
          <ToggleRow label="Sync on Wi-Fi only" value={s.wifiOnlySync} onChange={(v) => setSettings({ wifiOnlySync: v })} last />
        </View>
      </View>

      <View style={styles.privacy}>
        <ShieldIcon size={20} />
        <Text style={styles.privacyText}>{current.privacy}</Text>
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Developer</SectionLabel>
        <View style={styles.group}>
          <ToggleRow label="Simulate offline" value={simulatedOffline} onChange={setSimulatedOffline} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/spike')} style={[styles.rowBetween, styles.groupRow, { minHeight: 44 }]}>
            <Text style={styles.label}>Phase 0 spike</Text>
            <ChevronRight size={18} color={color.inkDisabled} />
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

/** "On-device · Decima-small · 21 ms" → "On-device · 21 ms" (the Settings header is narrower). */
const shortBadge = (badge: string) => {
  const parts = badge.split(' · ');
  return parts.length > 2 ? [parts[0], parts[parts.length - 1]].join(' · ') : badge;
};

function ToggleRow({ label, value, onChange, last, bare }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean; bare?: boolean }) {
  return (
    <View style={[styles.rowBetween, { minHeight: 44, gap: 12 }, !bare && styles.groupRow, !bare && !last && styles.divider]}>
      <Text style={[styles.label, { flexShrink: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: color.borderStrong, true: color.ink }}
        thumbColor="#FFFFFF"
        {...({ activeThumbColor: '#FFFFFF' } as object)} // react-native-web only
        ios_backgroundColor={color.borderStrong}
      />
    </View>
  );
}

function SmallButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.smallButton, primary ? styles.smallPrimary : styles.smallSecondary, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.smallButtonText, primary && { color: '#FFFFFF', fontFamily: font.bodySemibold }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  note: { fontFamily: font.body, fontSize: 12.5, lineHeight: 18, color: color.verdict.contradicted.fg },
  panel: { gap: 10, padding: 14, borderRadius: radius.input, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  mono: { fontFamily: font.mono, fontSize: 13, color: color.ink },
  small: { fontFamily: font.body, fontSize: 12.5, lineHeight: 18, color: color.inkMuted },
  label: { fontFamily: font.body, fontSize: 14, color: color.ink },
  fullBar: { height: 6, borderRadius: radius.chip, backgroundColor: color.link },
  group: { borderRadius: radius.input, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
  groupRow: { paddingHorizontal: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: color.divider, paddingVertical: 12 },
  smallButton: { height: 36, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  smallPrimary: { backgroundColor: color.ink, paddingHorizontal: 14 },
  smallSecondary: { borderWidth: 1, borderColor: color.borderStrong },
  smallButtonText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.ink },
  privacy: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: radius.input, backgroundColor: color.surfaceMuted },
  privacyText: { flex: 1, fontFamily: font.body, fontSize: 13, lineHeight: 19.5, color: color.inkBody },
});
