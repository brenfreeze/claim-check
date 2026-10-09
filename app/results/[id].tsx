import { router, useLocalSearchParams } from 'expo-router';
import { Share, StyleSheet, Text, View } from 'react-native';
import { useIsOnline } from '../../src/core/connectivity';
import { corpusInfo } from '../../src/core/factcheckCache';
import type { Verdict } from '../../src/core/checkTypes';
import { stillPending, type CheckState } from '../../src/ui/checkReducer';
import { useCheck } from '../../src/ui/checkStore';
import { ClaimCard } from '../../src/ui/components/claims';
import { NotFound } from '../../src/ui/components/NotFound';
import { OfflineBanner, SignalsPanel } from '../../src/ui/components/panels';
import { Card, IconButton, Meta, Screen, ScreenHeader } from '../../src/ui/components/primitives';
import { corpusLine, ENGINE_NAME, plural, relativeTime, seconds, SOURCE_LABEL, VERDICT_LABEL, verdictTotals } from '../../src/ui/format';
import { ChipIcon, ShareIcon, ShieldIcon } from '../../src/ui/icons';
import { color, font, radius, type } from '../../src/ui/tokens';

const TOTAL_ORDER: Verdict[] = ['contradicted', 'supported', 'unverified'];

export default function Results() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const check = useCheck(id);
  const online = useIsOnline();
  if (!check) return <NotFound />;

  const result = check.result;
  const claims = check.claims;
  const totals = verdictTotals(claims);
  const corpus = result?.corpus ?? corpusInfo();
  const sentenceCount = result?.sentenceCount;
  const waiting = stillPending(check);
  const running = check.status === 'running';
  const networkUsed = result?.networkUsed ?? false;

  return (
    <Screen>
      <ScreenHeader
        title="Results"
        onBack={() => router.replace('/')}
        right={
          <IconButton label="Share results" onPress={() => void Share.share({ message: shareText(check) })} disabled={!claims.length}>
            <ShareIcon size={20} />
          </IconButton>
        }
      />

      {!online ? <OfflineBanner count={corpus.count} synced={relativeTime(corpus.syncedAt)} /> : null}

      <View style={{ gap: 4 }}>
        <Meta>
          {SOURCE_LABEL[check.source]}
          {sentenceCount ? ` · ${plural(sentenceCount, 'sentence')}` : ''} · {relativeTime(check.createdAt)}
        </Meta>
        <Text style={type.h1Small} accessibilityRole="header">
          {running ? `${plural(claims.length, 'claim')} checked so far` : `${plural(claims.length, 'claim')} checked`}
        </Text>
      </View>

      <View style={styles.totals}>
        {TOTAL_ORDER.map((v) => (
          <View key={v} style={[styles.total, { backgroundColor: color.verdict[v].bg }]} accessible accessibilityLabel={`${totals[v]} ${VERDICT_LABEL[v]}`}>
            <Text style={[styles.totalNum, { color: color.verdict[v].fg }]}>{totals[v]}</Text>
            <Text style={[styles.totalLabel, { color: color.verdict[v].fg }]}>{VERDICT_LABEL[v]}</Text>
          </View>
        ))}
      </View>

      <View style={{ gap: 6 }}>
        <View style={styles.metaLine}>
          <ShieldIcon size={14} color={color.inkMuted} />
          <Meta style={{ flexShrink: 1 }}>{corpusLine(corpus)}</Meta>
        </View>
        {result ? (
          <View style={styles.metaLine}>
            <ChipIcon size={14} color={color.inkMuted} />
            <Meta>
              {ENGINE_NAME[result.stats.engine]} · {result.stats.decisions} decisions · {seconds(result.stats.totalMs)}
            </Meta>
          </View>
        ) : null}
      </View>

      <View style={{ gap: 10 }}>
        {claims.map((c, i) => (
          <ClaimCard key={c.id} claim={c} gate={check.gate} checkId={check.id} onPress={() => router.push(`/claim/${check.id}:${i}`)} />
        ))}
        {waiting.map((p) => (
          <Card key={p.id} dashed style={{ opacity: 0.7 }}>
            <Meta>Still checking…</Meta>
            <Text style={type.claimCard}>{p.text}</Text>
          </Card>
        ))}
      </View>

      {result ? <SignalsPanel signals={result.signals} /> : null}

      {result && !networkUsed ? (
        <View style={styles.metaLine}>
          <ChipIcon size={14} color={color.inkMuted} />
          <Meta>All judging ran on this phone · 0 bytes sent</Meta>
        </View>
      ) : null}

      <Text style={styles.footer}>Claim-Check rates each claim against sources. It never scores a whole post as “fake”.</Text>
    </Screen>
  );
}

function shareText(check: CheckState): string {
  const lines = check.claims.map((c) => `• ${VERDICT_LABEL[c.verdict]}: ${c.text}${c.evidence[0] ? ` (${c.evidence[0].publisher})` : ''}`);
  return ['Claim-Check results', ...lines, 'Each claim is rated against sources; the post as a whole is never scored.'].join('\n');
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: 8 },
  total: { flex: 1, borderRadius: radius.button, padding: 12, gap: 2 },
  totalNum: { fontFamily: font.display, fontSize: 28, lineHeight: 30 },
  totalLabel: { fontFamily: font.bodySemibold, fontSize: 12.5 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { fontFamily: font.body, fontSize: 12.5, lineHeight: 19, color: color.inkMuted },
});
