import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { OcrResult } from '../src/core/checkTypes';
import { recognizeText } from '../src/core/ocr';
import { startCheck } from '../src/ui/checkStore';
import { Button, Meta, Screen, ScreenHeader, SectionLabel } from '../src/ui/components/primitives';
import { plural } from '../src/ui/format';
import { CheckIcon } from '../src/ui/icons';
import { color, font, radius } from '../src/ui/tokens';

const CLAIM_GATE = 0.5;

export default function Scan() {
  const [uri, setUri] = useState<string | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [picking, setPicking] = useState(true);

  const pick = async () => {
    setPicking(true);
    let picked: string | null = null;
    if (Platform.OS !== 'web') {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (res.canceled) {
        setPicking(false);
        if (!ocr) router.back();
        return;
      }
      picked = res.assets[0]?.uri ?? null;
    }
    setUri(picked);
    const out = await recognizeText(picked);
    setOcr(out);
    setChecked(out.sentences.map((s) => s.claimScore >= CLAIM_GATE));
    setPicking(false);
  };

  useEffect(() => {
    void pick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = ocr ? ocr.sentences.filter((_, i) => checked[i]).map((s) => s.text) : [];
  const run = () => {
    if (!ocr) return;
    const input = ocr.sentences.map((s) => s.text).join(' ');
    router.replace(`/check/${startCheck(input, 'screenshot', selected)}`);
  };

  return (
    <Screen gap={16}>
      <ScreenHeader title="Scan screenshot" />

      <Pressable accessibilityRole="button" accessibilityLabel="Choose another screenshot" onPress={() => void pick()} style={styles.frame}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={styles.post}>
            <View style={styles.postHead}>
              <View style={styles.avatar} />
              <View style={{ gap: 2 }}>
                <Text style={styles.page}>[Page name]</Text>
                <Text style={styles.time}>3h · Public</Text>
              </View>
            </View>
            <View style={{ gap: 4 }}>
              {(ocr?.sentences ?? []).map((s, i) => (
                <Text key={i} style={[styles.postLine, s.claimScore >= CLAIM_GATE ? styles.lineClaim : styles.lineOther]}>
                  {s.text}
                </Text>
              ))}
            </View>
            <View style={styles.postImage}>
              <Text style={styles.time}>[Post image]</Text>
            </View>
          </View>
        )}
      </Pressable>

      <View style={styles.rowBetween}>
        <SectionLabel>Detected sentences</SectionLabel>
        <Meta>{picking ? 'reading…' : ocr ? `OCR on-device · ${ocr.ms} ms` : ''}</Meta>
      </View>

      {ocr ? (
        <View style={styles.group}>
          {ocr.sentences.map((s, i) => {
            const on = checked[i];
            const notClaim = s.claimScore < CLAIM_GATE;
            return (
              <Pressable
                key={i}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
                style={[styles.sentence, i < ocr.sentences.length - 1 && styles.divider]}
              >
                <View style={[styles.box, on && styles.boxOn]}>{on ? <CheckIcon size={14} color="#FFFFFF" /> : null}</View>
                <Text style={[styles.sentenceText, notClaim && { color: color.inkFaint }]}>
                  {s.text}
                  {notClaim ? <Text style={{ fontSize: 12 }}> — not a checkable claim</Text> : null}
                </Text>
                <Text style={[styles.claimScore, notClaim && { color: color.inkFaint }]}>claim {s.claimScore.toFixed(2).replace(/^0/, '')}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Button label={`Check ${plural(selected.length, 'claim')}`} variant="primary" disabled={!selected.length} onPress={run} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.card, backgroundColor: color.photoFrame, padding: 14 },
  image: { width: '100%', height: 320, borderRadius: 10 },
  post: { backgroundColor: color.surface, borderRadius: 10, padding: 12, gap: 8 },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: color.avatar },
  page: { fontFamily: font.bodySemibold, fontSize: 12.5, color: color.ink },
  time: { fontFamily: font.body, fontSize: 11, color: color.inkFaint },
  postLine: { fontFamily: font.body, fontSize: 12.5, lineHeight: 18, borderRadius: 3, borderWidth: 1.5, borderStyle: 'dashed', paddingHorizontal: 2 },
  lineClaim: { borderColor: color.link, backgroundColor: color.linkBg, color: color.ink },
  lineOther: { borderColor: color.inkDisabled, color: color.inkFaint },
  postImage: { height: 70, borderRadius: 6, backgroundColor: color.placeholder, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  group: { borderWidth: 1, borderColor: color.border, borderRadius: radius.input, backgroundColor: color.surface },
  sentence: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: color.divider },
  box: { width: 20, height: 20, marginTop: 1, borderRadius: 4, borderWidth: 1.5, borderColor: color.inkDisabled, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: color.ink, borderColor: color.ink },
  sentenceText: { flex: 1, fontFamily: font.body, fontSize: 14, lineHeight: 19.5, color: color.ink },
  claimScore: { fontFamily: font.mono, fontSize: 11, color: color.inkMuted, paddingTop: 2 },
});
