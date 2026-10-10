import { Linking, StyleSheet, Text, View } from 'react-native';
import { useCorpusInfo } from '../src/core/factcheckCache';
import { Card, Meta, Screen, ScreenHeader, SectionLabel } from '../src/ui/components/primitives';
import { color, font, type } from '../src/ui/tokens';

// What the app does and, honestly, what the hackathon build leaves out.
const FACT_CHECK_TOOLS_URL = 'https://developers.google.com/fact-check/tools/api';
const FEATURES: [string, string][] = [
  ['Works without internet', 'Every check runs on this phone. Nothing is sent anywhere unless you tap Online enrichment.'],
  [
    'Saved fact-checks',
    'Each claim is compared with published fact-checks from Rappler, VERA Files and AFP Fact Check, saved in the app. Settings → Sync now adds newer ones while you’re online.',
  ],
  [
    'On-device AI',
    'A small model (Decima-small, fine-tuned on Philippine fact-check pairs) decides whether your post makes the same claim as a fact-check. It reads English, Filipino and Taglish.',
  ],
  ['Screenshots', 'Scan reads the text in a screenshot with Apple’s on-device text recognition, then lets you pick the claims to check.'],
  ['Online enrichment', 'When you’re online, an Unverified claim can be searched against newly published fact-checks. Offline, it waits in a queue.'],
];

const HELD_BACK: string[] = [
  'It finds debunks, it doesn’t judge truth. Filipino fact-checkers mostly publish “false” and “misleading” verdicts, so “Unverified” means “no saved fact-check matches”, not “true”.',
  'Only Rappler, VERA Files and AFP publish to Google’s fact-check index, so Tsek.ph and newsroom fact-checks aren’t included. Syncing is manual (Settings → Sync now); there’s no background sync.',
  'Matching misses some posts. A Taglish post doesn’t always reach an English-language fact-check, and the model can miss negation (“will NOT…”). A few demo posts have hand-written Taglish aliases to help them match.',
  'The match threshold (0.85) comes from a small test set of 15 posts, not a full evaluation.',
  'Each sentence is checked on its own. Claims that span sentences or lean on context (“Ganyan din si…”, “Sabi niya yan”) lose their meaning, so long personal stories check poorly. Finding claims uses a simple rule (sentence length, “share” prompts), not the model.',
  'The fine-tuned model was trained on fact-check text we don’t have permission to redistribute. A public release needs that permission or retraining on licensed data.',
  'Only on-device Decima runs checks. Apple’s on-device model is built but hidden (it fails on some posts); laptop and hosted engines aren’t built yet.',
  'No share-sheet extension yet: copy and paste, or scan a screenshot. Screenshot scanning is iPhone-only for now.',
  'Online enrichment uses an API key bundled in this test build.',
];

export default function About() {
  const corpus = useCorpusInfo();
  return (
    <Screen gap={18}>
      <ScreenHeader title="About CheckitFirst" />

      <View style={{ gap: 8 }}>
        <Text style={type.h1Small}>Has this already been fact-checked?</Text>
        <Text style={type.body}>
          CheckitFirst answers that on your phone, even with no signal. Paste a post or scan a screenshot, and every claim is matched against{' '}
          {corpus.count.toLocaleString('en-US')} saved fact-checks. Built for a hackathon on AI that stays useful when the cloud disappears.
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>What it does</SectionLabel>
        {FEATURES.map(([title, body]) => (
          <View key={title} style={styles.item}>
            <Text style={styles.itemTitle}>{title}</Text>
            <Text style={styles.itemBody}>{body}</Text>
          </View>
        ))}
      </View>

      <Card style={{ gap: 6 }}>
        <Text style={styles.itemTitle}>Powered by the Google Fact Check Tools API</Text>
        <Text style={styles.itemBody}>
          Every saved fact-check comes from Google’s ClaimReview index: the claim, the publisher’s rating and a link to the article. Fact-checkers
          publish these; we only store the claim and rating, never the article text.
        </Text>
        <Text accessibilityRole="link" onPress={() => void Linking.openURL(FACT_CHECK_TOOLS_URL)} suppressHighlighting style={styles.link}>
          developers.google.com/fact-check/tools/api ↗
        </Text>
      </Card>

      <View style={{ gap: 10 }}>
        <SectionLabel>What we held back</SectionLabel>
        <Card muted style={{ gap: 10 }}>
          {HELD_BACK.map((line) => (
            <View key={line} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.itemBody}>{line}</Text>
            </View>
          ))}
        </Card>
      </View>

      <Meta>Fact-checks © their publishers; open any match to read the full article on their site.</Meta>
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: 2 },
  itemTitle: { fontFamily: font.bodySemibold, fontSize: 15, lineHeight: 21, color: color.ink },
  itemBody: { flex: 1, fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.inkBody },
  bulletRow: { flexDirection: 'row', gap: 8 },
  link: { fontFamily: font.bodyMedium, fontSize: 14, color: color.link },
  bullet: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.inkMuted },
});
