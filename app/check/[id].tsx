import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { effectiveEngine } from '../../src/core/engines';
import { useSettings } from '../../src/core/settings';
import { stillPending } from '../../src/ui/checkReducer';
import { cancelCheck, retryCheck, useCheck } from '../../src/ui/checkStore';
import { PipelineStepper, type StepperStep } from '../../src/ui/components/panels';
import { Button, ListGroup, Meta, Row, Screen, SectionLabel } from '../../src/ui/components/primitives';
import { NotFound } from '../../src/ui/components/NotFound';
import { EngineBadge, VerdictChip } from '../../src/ui/components/verdict';
import { plural } from '../../src/ui/format';
import { color, font, type } from '../../src/ui/tokens';

export default function Analyzing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const check = useCheck(id);
  const settings = useSettings();

  // Finished: replace this screen with Results.
  useEffect(() => {
    if (check?.status === 'done') router.replace(`/results/${check.id}`);
  }, [check?.status, check?.id]);

  if (!check) return <NotFound />;

  const engine = effectiveEngine(check.engine, settings.lanUrl);
  const onDevice = check.engine === 'decima-local' || check.engine === 'apple-on-device';
  const claimCount = check.pending.length;
  const steps: StepperStep[] = [
    { title: 'Find claims', description: 'Looking for checkable sentences', ...check.steps.extract },
    {
      title: 'Match saved fact-checks',
      description: 'Each claim compared with published fact-checks stored on this phone',
      ...check.steps.match,
      progress: check.progress,
    },
    { title: 'Calibrate verdicts', description: `Anything under ${check.gate.toFixed(2)} confidence becomes Unverified`, ...check.steps.aggregate },
  ];
  const waiting = stillPending(check);
  const cancel = () => {
    cancelCheck(check.id);
    router.replace('/');
  };

  return (
    <Screen gap={20}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={cancel} style={styles.cancel} hitSlop={8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <EngineBadge label={onDevice ? 'On-device' : engine.name} />
      </View>

      <View style={{ gap: 6 }}>
        <Text style={[type.h1, { fontSize: 29, lineHeight: 33 }]} accessibilityRole="header">
          {claimCount ? `Checking ${plural(claimCount, 'claim')}` : 'Finding claims'}
        </Text>
        <Text style={styles.lede}>
          {onDevice ? 'Everything runs on this phone. Nothing is sent.' : `Claims are judged by ${engine.name}. ${engine.privacy}`}
        </Text>
      </View>

      {check.status === 'error' ? (
        <View style={styles.error} accessibilityRole="alert">
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{check.error}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label="Retry"
              variant="primary"
              height={44}
              onPress={() => {
                const next = retryCheck(check.id);
                if (next) router.replace(`/check/${next}`);
              }}
              style={{ flex: 1 }}
            />
            <Button label="Back" height={44} onPress={() => router.replace('/')} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <PipelineStepper steps={steps} />
      )}

      {check.pending.length ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>So far</SectionLabel>
          <ListGroup>
            {check.claims.map((c) => (
              <Row key={c.id}>
                <Text style={styles.rowText} numberOfLines={1}>
                  {c.text}
                </Text>
                <VerdictChip verdict={c.verdict} />
              </Row>
            ))}
            {waiting.map((p, i) => (
              <Row key={p.id} last={i === waiting.length - 1}>
                <Text style={[styles.rowText, { color: color.inkFaint }]} numberOfLines={1}>
                  {p.text}
                </Text>
                <Meta style={{ color: color.inkFaint }}>{i === 0 ? 'matching…' : 'waiting'}</Meta>
              </Row>
            ))}
          </ListGroup>
        </View>
      ) : null}

      {check.claims.length && check.status === 'running' ? (
        <Button label="See results so far" onPress={() => router.push(`/results/${check.id}`)} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancel: { height: 44, justifyContent: 'center' },
  cancelText: { fontFamily: font.body, fontSize: 15, color: color.inkSecondary },
  lede: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21.75, color: color.inkSecondary },
  rowText: { flex: 1, fontFamily: font.body, fontSize: 14, color: color.ink },
  error: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: color.verdict.contradicted.bg },
  errorTitle: { fontFamily: font.bodySemibold, fontSize: 15, color: color.verdict.contradicted.fg },
  errorText: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: color.inkBody },
});
