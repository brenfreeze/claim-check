// Claim cards (Results), the matched-fact-check block, Online enrichment control, evidence cards (Claim detail).
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClaimResult, EvidenceSource } from '../../core/checkTypes';
import { useIsOnline } from '../../core/connectivity';
import { enrich } from '../checkStore';
import { confidenceLabel, score, shortDate, sourceSummary, STANCE_LABEL } from '../format';
import { ChevronRight, ExternalIcon, SearchIcon } from '../icons';
import { color, font, type } from '../tokens';
import { ExpandableText } from './ExpandableText';
import { Button, Card } from './primitives';
import { RatingPill, TierBadge, VerdictChip } from './verdict';

/** The fact-check an offline match points at (kind 'factcheck' with a ClaimReview rating). */
export function matchedFactcheck(claim: ClaimResult): EvidenceSource | undefined {
  return claim.path === 'offline-match' ? claim.evidence.find((e) => e.kind === 'factcheck' && e.claimReview) : undefined;
}

export function ClaimCard({ claim, gate, checkId, onPress }: { claim: ClaimResult; gate: number; checkId: string; onPress: () => void }) {
  const unverified = claim.verdict === 'unverified';
  const fc = matchedFactcheck(claim);
  const noSavedMatch = unverified && claim.path === 'offline-match' && !fc;
  const enrichable = unverified && !!claim.enrichment && !(claim.path === 'live-search' && claim.enrichment.status === 'done');
  // The pressable area and the enrichment button are siblings: a button can't nest inside another button.
  return (
    <Card dashed={unverified}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the evidence for this claim"
        onPress={onPress}
        style={({ pressed }) => [{ gap: 10 }, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.cardTop}>
          <VerdictChip verdict={claim.verdict} />
          <Text style={styles.score}>{noSavedMatch ? 'no saved match' : confidenceLabel(claim, gate)}</Text>
        </View>
        <ExpandableText text={claim.text} max={140} style={type.claimCard} />
        {unverified ? (
          <ExpandableText text={claim.reason} max={140} style={styles.reason} />
        ) : claim.original !== claim.text ? (
          <ExpandableText text={claim.original} max={90} prefix="“" suffix="”" style={styles.quote} />
        ) : null}
        {fc ? <FactcheckBlock source={fc} related={unverified} /> : null}
        {enrichable ? null : (
          <View style={styles.cardFooter}>
            <Text style={styles.footerText} numberOfLines={1}>
              {claim.path === 'offline-match' ? 'Matched on this phone' : sourceSummary(claim.evidence)}
            </Text>
            <View style={styles.evidenceLink}>
              <Text style={styles.evidenceLinkText}>Evidence</Text>
              <ChevronRight size={14} color={color.link} strokeWidth={2} />
            </View>
          </View>
        )}
      </Pressable>
      {enrichable ? <EnrichmentControl checkId={checkId} claim={claim} /> : null}
    </Card>
  );
}

/** "Matched saved fact-check · match 0.89", headline, "Publisher · date · rated [False]". */
export function FactcheckBlock({ source, related }: { source: EvidenceSource; related?: boolean }) {
  return (
    <View style={styles.fcBlock}>
      <View style={styles.rowBetween}>
        <Text style={styles.fcLabel}>{related ? 'Related saved fact-check' : 'Matched saved fact-check'}</Text>
        <Text style={styles.fcMatch}>match {score(source.confidence)}</Text>
      </View>
      <ExpandableText text={source.claimReview?.headline ?? source.title} max={120} style={styles.fcHeadline} />
      {source.snippet && source.snippet !== (source.claimReview?.headline ?? source.title) ? (
        <ExpandableText text={source.snippet} max={110} style={styles.fcSummary} />
      ) : null}
      <View style={styles.fcMeta}>
        <Text style={styles.fcMetaText}>
          {source.publisher}
          {source.date ? ` · ${shortDate(source.date)}` : ''} · rated
        </Text>
        {source.claimReview ? <RatingPill rating={source.claimReview.rating} small /> : null}
      </View>
      {/* ClaimReview summaries are often cut short at the source ("…"); the full text lives on the publisher's page */}
      <Text accessibilityRole="link" onPress={() => void Linking.openURL(source.url)} suppressHighlighting style={styles.fcLink}>
        Read full fact-check on {source.domain} ↗
      </Text>
    </View>
  );
}

/** Online enrichment: run live search for an Unverified claim, or queue it while offline. */
export function EnrichmentControl({ checkId, claim }: { checkId: string; claim: ClaimResult }) {
  const online = useIsOnline();
  const status = claim.enrichment?.status ?? 'idle';
  if (claim.path === 'live-search' && status === 'done') return null;
  return (
    <View style={styles.enrich}>
      {status === 'queued' ? (
        <View style={styles.queued} accessibilityLiveRegion="polite">
          <View style={styles.dot} />
          <Text style={styles.queuedText}>Queued for recheck</Text>
        </View>
      ) : status === 'running' ? (
        <View style={styles.queued} accessibilityLiveRegion="polite">
          <View style={[styles.dot, styles.dotPulse]} />
          <Text style={styles.queuedText}>{claim.enrichment?.message ?? 'Checking online…'}</Text>
        </View>
      ) : (
        <>
          {status === 'failed' ? <Text style={styles.failed}>Online check failed: {claim.enrichment?.message}</Text> : null}
          <Button
            label={online ? 'Online enrichment' : 'Recheck when online'}
            icon={<SearchIcon size={16} />}
            height={40}
            onPress={() => void enrich(checkId, claim.id)}
            textStyle={{ fontSize: 14 }}
          />
          <Text style={styles.enrichHint}>
            {online ? 'Searches the web for this claim. The claim text leaves the phone.' : "You're offline. We'll search as soon as you're back online."}
          </Text>
        </>
      )}
    </View>
  );
}

export function EvidenceCard({ source }: { source: EvidenceSource }) {
  const unrelated = source.stance === 'unrelated';
  const stanceColor = source.stance === 'contradicts' ? color.verdict.contradicted.fg : source.stance === 'supports' ? color.verdict.supported.fg : color.inkMuted;
  const isFactcheck = source.kind === 'factcheck';
  return (
    <Card muted={unrelated} style={unrelated && { borderColor: color.border }}>
      <View style={[styles.rowBetween, { gap: 8 }]}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Text style={[styles.publisher, unrelated && { color: '#3A3935' }]}>
            {source.publisher}
            {isFactcheck ? ' · Fact-check' : ''}
          </Text>
          <Text style={styles.domain}>
            {source.domain}
            {source.date ? ` · ${shortDate(source.date)}` : ''}
          </Text>
        </View>
        <TierBadge tier={source.tier} kind={source.kind} />
      </View>
      {source.claimReview ? (
        <View style={styles.fcMeta}>
          <Text style={styles.fcMetaText}>Published rating</Text>
          <RatingPill rating={source.claimReview.rating} />
        </View>
      ) : null}
      <Text style={[styles.snippet, unrelated && { color: color.inkMuted }]}>
        {isFactcheck && source.claimReview ? `${source.claimReview.headline} — ` : source.title && !unrelated ? `${source.title} — ` : ''}
        <Text style={unrelated ? undefined : styles.mark}>{source.snippet}</Text>
      </Text>
      <View style={styles.cardFooter}>
        <Text style={[styles.stance, { color: stanceColor }]}>
          {unrelated ? STANCE_LABEL.unrelated : `${STANCE_LABEL[source.stance]} · ${isFactcheck ? 'match ' : ''}${score(source.confidence)}`}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(source.url)} style={styles.openSource} hitSlop={6}>
          <Text style={styles.evidenceLinkText}>Open source</Text>
          <ExternalIcon size={14} color={color.link} />
        </Pressable>
      </View>
    </Card>
  );
}


const styles = StyleSheet.create({
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  score: { fontFamily: font.mono, fontSize: 12, color: color.inkSecondary },
  quote: { fontFamily: font.bodyItalic, fontSize: 13, lineHeight: 18, color: color.inkMuted },
  reason: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.inkMuted },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: color.divider,
    gap: 8,
  },
  footerText: { flexShrink: 1, fontFamily: font.body, fontSize: 12.5, color: color.inkSecondary },
  evidenceLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  evidenceLinkText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.link },
  fcBlock: { gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: color.surfaceSubtle },
  fcLabel: { fontFamily: font.bodySemibold, fontSize: 12, color: color.inkSecondary },
  fcMatch: { fontFamily: font.mono, fontSize: 11, color: color.inkMuted },
  fcHeadline: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: color.ink },
  fcSummary: { fontFamily: font.body, fontSize: 12.5, lineHeight: 18, color: color.inkSecondary },
  fcMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fcMetaText: { fontFamily: font.body, fontSize: 12, color: color.inkMuted },
  enrich: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: color.divider },
  enrichHint: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.inkMuted },
  queued: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.link },
  dotPulse: { opacity: 0.6 },
  queuedText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.link },
  failed: { fontFamily: font.body, fontSize: 12.5, color: color.verdict.contradicted.fg },
  publisher: { fontFamily: font.bodySemibold, fontSize: 14.5, color: color.ink },
  domain: { fontFamily: font.mono, fontSize: 11, color: color.inkMuted },
  fcLink: { fontFamily: font.bodyMedium, fontSize: 13, color: color.link },
  snippet: { fontFamily: font.body, fontSize: 13.5, lineHeight: 20, color: color.inkBody },
  mark: { backgroundColor: '#FFF1A8' },
  stance: { fontFamily: font.bodySemibold, fontSize: 12.5 },
  openSource: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
});

