import * as Clipboard from 'expo-clipboard';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { effectiveEngine } from '../src/core/engines';
import { corpusInfo } from '../src/core/factcheckCache';
import { useSettings } from '../src/core/settings';
import { useSharedText } from '../src/core/shareIntent';
import { detectLanguage, splitSentences } from '../src/core/text';
import { startCheck, useRecentChecks } from '../src/ui/checkStore';
import { Button, IconButton, Meta, Screen, SectionLabel } from '../src/ui/components/primitives';
import { EngineBadge, InfoPill } from '../src/ui/components/verdict';
import { plural, recentMeta, relativeTime } from '../src/ui/format';
import { CameraIcon, ChevronRight, ClipboardIcon, SlidersIcon } from '../src/ui/icons';
import { color, font, radius, type } from '../src/ui/tokens';

// The Phase 0 device protocol (EXPO_PUBLIC_AUTORUN=1) still launches straight into the spike screen.
const AUTORUN = process.env.EXPO_PUBLIC_AUTORUN === '1';

export default function Home() {
  const shared = useSharedText();
  // claimcheck://?text=… (and /?text=… on web) pre-fills the box: demo links and quick reruns.
  const { text: linked } = useLocalSearchParams<{ text?: string }>();
  const [text, setText] = useState(shared ?? linked ?? '');
  const settings = useSettings();
  const engine = effectiveEngine(settings.engine, settings.lanUrl);
  const recent = useRecentChecks(5);
  const corpus = corpusInfo();

  // Re-read on change, not only at mount: a link or share can arrive while Home is already open.
  useEffect(() => {
    if (shared) setText(shared);
  }, [shared]);
  useEffect(() => {
    if (linked) setText(linked);
  }, [linked]);

  if (AUTORUN) return <Redirect href="/spike" />;

  const sentences = splitSentences(text).length;
  const language = detectLanguage(text);
  const check = () => router.push(`/check/${startCheck(text.trim(), shared && text === shared ? 'share' : 'paste')}`);
  const paste = async () => {
    const clip = await Clipboard.getStringAsync();
    if (clip) setText(clip);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Text style={styles.wordmark}>CheckitFirst</Text>
          <View style={styles.region}>
            <Text style={styles.regionText}>PH</Text>
          </View>
        </View>
        <IconButton label="Settings" onPress={() => router.push('/settings')}>
          <SlidersIcon size={22} />
        </IconButton>
      </View>

      <View style={styles.pills}>
        <EngineBadge label={engine.badge} />
        <InfoPill label={`${corpus.count.toLocaleString('en-US')} fact-checks · synced ${relativeTime(corpus.syncedAt)}`} />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={type.h1} accessibilityRole="header">
          Check what you just read.
        </Text>
        <Text style={styles.lede}>
          Paste a post or scan a screenshot. Every claim is matched against saved fact-checks, right on this
          phone.
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <SectionLabel>Text to check</SectionLabel>
        <TextInput
          accessibilityLabel="Text to check"
          multiline
          value={text}
          onChangeText={setText}
          placeholder="Paste or type a post…"
          placeholderTextColor={color.inkDisabled}
          style={styles.input}
          textAlignVertical="top"
        />
        <View style={styles.inputMeta}>
          <Meta>{text.trim() ? plural(sentences, 'sentence') : ' '}</Meta>
          <Meta>{language ? `${language} detected` : ''}</Meta>
        </View>
      </View>

      <Button label="Check claims" variant="primary" disabled={!text.trim()} onPress={check} />

      <View style={styles.grid}>
        <Button label="Scan screenshot" icon={<CameraIcon />} onPress={() => router.push('/scan')} style={{ flex: 1 }} />
        <Button label="Paste" icon={<ClipboardIcon />} onPress={() => void paste()} style={{ flex: 1 }} />
      </View>

      <Pressable accessibilityRole="button" onPress={() => router.push('/scan?demo=1')} style={styles.hint}>
        <CameraIcon size={16} color={color.inkMuted} />
        <Text style={styles.hintText}>Or try the demo screenshot →</Text>
      </Pressable>

      {recent.length ? (
        <View style={{ gap: 8, marginTop: 2 }}>
          <SectionLabel>Recent checks</SectionLabel>
          {recent.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              onPress={() => router.push(c.status === 'running' ? `/check/${c.id}` : `/results/${c.id}`)}
              style={({ pressed }) => [styles.recent, pressed && { opacity: 0.8 }]}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={styles.recentTitle} numberOfLines={1}>
                  {c.input}
                </Text>
                <Meta numberOfLines={1}>{recentMeta(c.createdAt, c.claims, c.status === 'running')}</Meta>
              </View>
              <ChevronRight size={18} color={color.inkDisabled} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: { fontFamily: font.display, fontSize: 23, letterSpacing: -0.23, color: color.ink },
  region: { borderWidth: 1, borderColor: color.borderStrong, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  regionText: { fontFamily: font.mono, fontSize: 11, color: color.inkMuted },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  lede: { fontFamily: font.body, fontSize: 15, lineHeight: 22.5, color: color.inkSecondary },
  input: {
    minHeight: 168,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.input,
    backgroundColor: color.surface,
    padding: 14,
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 22.5,
    color: color.ink,
  },
  inputMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', gap: 10 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintText: { fontFamily: font.body, fontSize: 13, color: color.inkMuted, flexShrink: 1 },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
  },
  recentTitle: { fontFamily: font.bodyMedium, fontSize: 14.5, color: color.ink },
});
