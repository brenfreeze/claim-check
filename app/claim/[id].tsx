import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { useCheck } from '../../src/ui/checkStore';
import { EnrichmentControl, EvidenceCard } from '../../src/ui/components/claims';
import { NotFound } from '../../src/ui/components/NotFound';
import { Button, Card, goBack, IconButton, Screen, SectionLabel } from '../../src/ui/components/primitives';
import { ConfidenceBar, VerdictChip } from '../../src/ui/components/verdict';
import { ENGINE_SHORT, plural, score, seconds, VERDICT_LABEL } from '../../src/ui/format';
import { ChevronLeft, ChevronRight } from '../../src/ui/icons';
import { color, font, radius, type } from '../../src/ui/tokens';

export default function ClaimDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [checkId, indexStr] = String(id ?? '').split(':');
  const index = Number(indexStr);
  const check = useCheck(checkId);
  const [reported, setReported] = useState(false);
  const claim = check?.claims[index];
  if (!check || !claim) return <NotFound />;

  const count = check.claims.length;
  const go = (i: number) => router.setParams({ id: `${checkId}:${i}` });
  const related = claim.evidence.filter((e) => e.stance !== 'unrelated').length;
  const offlineMatch = claim.path === 'offline-match';

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <IconButton label="Back to results" onPress={goBack} style={{ marginLeft: -10 }}>
            <ChevronLeft size={22} />
          </IconButton>
          <Text style={styles.position}>
            Claim {index + 1} of {count}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <IconButton label="Previous claim" disabled={index === 0} onPress={() => go(index - 1)}>
            <ChevronLeft size={22} color={index === 0 ? color.inkDisabled : color.ink} />
          </IconButton>
          <IconButton label="Next claim" disabled={index >= count - 1} onPress={() => go(index + 1)}>
            <ChevronRight size={22} color={index >= count - 1 ? color.inkDisabled : color.ink} />
          </IconButton>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={type.claimDetail} accessibilityRole="header">
          {claim.text}
        </Text>
        <Text style={styles.from}>
          From the post: <Text style={styles.italic}>“{claim.original}”</Text>
        </Text>
      </View>

      <Card style={{ gap: 12, padding: 16 }}>
        <View style={styles.rowBetween}>
          <VerdictChip verdict={claim.verdict} size="lg" />
          <Text style={styles.confidence}>{score(claim.confidence)} confidence</Text>
        </View>
        <ConfidenceBar value={claim.confidence} gate={check.gate} verdict={claim.verdict} />
        <Text style={styles.reason}>{claim.reason}</Text>
        {claim.verdict === 'unverified' && claim.enrichment ? <EnrichmentControl checkId={check.id} claim={claim} /> : null}
      </Card>

      {claim.evidence.length ? (
        <>
          <View style={styles.rowBaseline}>
            <SectionLabel>
              {offlineMatch ? 'Saved fact-check' : `Evidence · ${plural(claim.evidence.length, 'source')}`}
            </SectionLabel>
            <Text style={styles.note}>{offlineMatch ? 'Matched on this phone' : 'Strongest first'}</Text>
          </View>
          <View style={{ gap: 10 }}>
            {claim.evidence.map((e) => (
              <EvidenceCard key={`${e.url}-${e.publisher}`} source={e} />
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.decided}>
        <Text style={styles.decidedLabel}>How this was decided</Text>
        <Fact label="Path" value={offlineMatch ? 'saved fact-check match · offline' : 'live search · online'} />
        <Fact label="Engine" value={ENGINE_SHORT[claim.stats.engine]} />
        <Fact label="Decisions" value={`${claim.stats.decisions} ${offlineMatch ? 'candidates' : 'chunks'} · ${seconds(claim.stats.ms)}`} />
        <Fact label="Rule" value={claim.stats.rule} />
        <Fact label="Calibration" value={claim.stats.calibration} />
        {related ? null : <Fact label="Sources" value="none related" />}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button
          label="Share verdict"
          onPress={() => void Share.share({ message: `${VERDICT_LABEL[claim.verdict]} (${score(claim.confidence)}): ${claim.text}\n${claim.reason}` })}
          style={{ flex: 1 }}
          textStyle={{ fontSize: 14 }}
        />
        <Button
          label={reported ? 'Thanks — noted' : 'Report wrong verdict'}
          variant="ghost"
          disabled={reported}
          onPress={() => setReported(true)}
          style={{ flex: 1, backgroundColor: 'transparent' }}
          textStyle={{ fontSize: 14, color: color.inkSecondary }}
        />
      </View>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  position: { fontFamily: font.body, fontSize: 14, color: color.inkSecondary },
  from: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19.5, color: color.inkMuted },
  italic: { fontFamily: font.bodyItalic },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowBaseline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  confidence: { fontFamily: font.mono, fontSize: 13, color: color.ink },
  reason: { fontFamily: font.body, fontSize: 14, lineHeight: 21, color: color.inkBody },
  note: { fontFamily: font.body, fontSize: 12, color: color.inkMuted },
  decided: { borderRadius: radius.card, backgroundColor: color.surfaceMuted, paddingVertical: 4, paddingHorizontal: 14 },
  decidedLabel: {
    paddingTop: 10,
    paddingBottom: 6,
    fontFamily: font.bodySemibold,
    fontSize: 12,
    letterSpacing: 0.72,
    textTransform: 'uppercase',
    color: color.inkSecondary,
  },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: color.borderPanel },
  factLabel: { fontFamily: font.body, fontSize: 13, color: color.inkSecondary },
  factValue: { fontFamily: font.mono, fontSize: 12, color: color.ink, flexShrink: 1, textAlign: 'right' },
});
