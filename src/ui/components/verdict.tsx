// Verdict chip, confidence bar with gate marker, rating pill, tier badge, engine badge.
import { StyleSheet, Text, View } from 'react-native';
import type { EvidenceSource, Verdict } from '../../core/checkTypes';
import { KIND_LABEL, ratingLabel, ratingVerdict, score, VERDICT_LABEL } from '../format';
import { CheckIcon, ChipIcon, QuestionIcon, XIcon } from '../icons';
import { color, font, radius } from '../tokens';

/** Icon + word, never color alone. */
export function VerdictChip({ verdict, size = 'sm' }: { verdict: Verdict; size?: 'sm' | 'lg' }) {
  const c = color.verdict[verdict];
  const lg = size === 'lg';
  const iconSize = lg ? 14 : 12;
  const Icon = verdict === 'supported' ? CheckIcon : verdict === 'contradicted' ? XIcon : QuestionIcon;
  return (
    <View
      accessible
      accessibilityLabel={`Verdict: ${VERDICT_LABEL[verdict]}`}
      style={[styles.chip, { backgroundColor: c.bg }, lg ? styles.chipLg : styles.chipSm]}
    >
      <Icon size={iconSize} color={c.fg} />
      <Text style={[styles.chipText, { color: c.fg, fontSize: lg ? 15 : 12.5 }]}>{VERDICT_LABEL[verdict]}</Text>
    </View>
  );
}

/** Fill in the verdict's bar color, 2px ink marker at the gate. */
export function ConfidenceBar({ value, gate, verdict }: { value: number; gate: number; verdict: Verdict }) {
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`Confidence ${score(value)}, gate ${score(gate)}`}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(value * 100)}%`, backgroundColor: color.verdict[verdict].bar }]} />
        <View style={[styles.gate, { left: `${gate * 100}%` }]} />
      </View>
      <View style={styles.scale}>
        <Text style={styles.scaleText}>0</Text>
        <Text style={[styles.scaleText, styles.gateLabel, { left: `${gate * 100}%` }]}>gate {score(gate)}</Text>
        <Text style={styles.scaleText}>1</Text>
      </View>
    </View>
  );
}

/** Published ClaimReview rating ("False", "Misleading", "True"), outlined in its verdict color. */
export function RatingPill({ rating, small }: { rating: string; small?: boolean }) {
  const v = ratingVerdict(rating);
  const c = color.verdict[v];
  return (
    <View style={[styles.rating, { borderColor: c.bar }, small && { paddingVertical: 1, paddingHorizontal: 7 }]}>
      <Text style={[styles.ratingText, { color: c.fg, fontSize: small ? 11.5 : 12 }]}>{ratingLabel(rating)}</Text>
    </View>
  );
}

/** Tier A filled ink, B/C outlined. */
export function TierBadge({ tier, kind }: Pick<EvidenceSource, 'tier' | 'kind'>) {
  const filled = tier === 'A';
  return (
    <View style={[styles.tier, filled ? styles.tierFilled : styles.tierOutlined]}>
      <Text style={[styles.tierText, { color: filled ? '#FFFFFF' : color.inkMuted }]}>
        Tier {tier} · {KIND_LABEL[kind]}
      </Text>
    </View>
  );
}

/** Ink pill with mono text naming the engine (Home, Analyzing, Settings). */
export function EngineBadge({ label, icon = true }: { label: string; icon?: boolean }) {
  return (
    <View style={styles.engine} accessible accessibilityLabel={`Engine: ${label}`}>
      {icon ? <ChipIcon size={14} color={color.onInk} /> : null}
      <Text style={styles.engineText}>{label}</Text>
    </View>
  );
}

/** Neutral mono pill ("Fact-checks synced 2h ago"). */
export function InfoPill({ label }: { label: string }) {
  return (
    <View style={[styles.engine, { backgroundColor: color.placeholder }]}>
      <Text style={[styles.engineText, { color: color.inkSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: radius.chip },
  chipSm: { gap: 5, paddingVertical: 3, paddingHorizontal: 9 },
  chipLg: { gap: 6, paddingVertical: 5, paddingHorizontal: 12 },
  chipText: { fontFamily: font.bodySemibold },
  track: { height: 8, borderRadius: radius.chip, backgroundColor: color.divider },
  fill: { height: 8, borderRadius: radius.chip },
  gate: { position: 'absolute', top: -4, width: 2, height: 16, marginLeft: -1, backgroundColor: color.ink },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  scaleText: { fontFamily: font.mono, fontSize: 11, color: color.inkMuted },
  gateLabel: { position: 'absolute', transform: [{ translateX: -28 }] },
  rating: { borderWidth: 1, borderRadius: radius.tag, paddingVertical: 2, paddingHorizontal: 8, alignSelf: 'flex-start' },
  ratingText: { fontFamily: font.bodySemibold },
  tier: { borderRadius: radius.tag, paddingVertical: 3, paddingHorizontal: 8, flexShrink: 0 },
  tierFilled: { backgroundColor: color.ink },
  tierOutlined: { borderWidth: 1, borderColor: color.borderStrong },
  tierText: { fontFamily: font.mono, fontSize: 11 },
  engine: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.chip,
    backgroundColor: color.ink,
  },
  engineText: { fontFamily: font.mono, fontSize: 11.5, color: color.onInk },
});
