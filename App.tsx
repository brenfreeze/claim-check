// Phase 0 debug screen (throwaway): load Decima on device, run one decision, the fixture protocol and the benchmark.
// EXPO_PUBLIC_AUTORUN=1 runs load → benchmark → fixtures on start and logs PHASE0_RESULT lines to logcat.
import { StatusBar } from 'expo-status-bar';
import * as ort from 'onnxruntime-react-native';
import { useEffect, useRef, useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appleLlmAvailability, appleLlmBackend } from './modules/apple-llm';
import { memSnapshot } from './modules/mem-probe';
import { FACT_CHECK_INSTRUCTIONS, runLlmFixtures, type LlmFixtureReport } from './src/app/llmProtocol';
import { benchmark, runFixtures, type BenchReport, type FixtureReport } from './src/app/phase0';
import { downloadModel, listModelFiles, modelDir, modelPresent, readText, sessionPath } from './src/app/modelStore';
import { LlmDecisionEngine, OnDeviceDecimaEngine, type Decision } from './src/engine';

const DEFAULT_BASE_URL = process.env.EXPO_PUBLIC_MODEL_URL ?? 'http://10.0.2.2:8765';
const AUTORUN = process.env.EXPO_PUBLIC_AUTORUN === '1';
const THREADS = [1, 2, 4];
const AUTORUN_THREADS = Number(process.env.EXPO_PUBLIC_THREADS ?? 2);
const AUTORUN_ENGINE = process.env.EXPO_PUBLIC_ENGINE ?? 'decima'; // 'decima' | 'apple'

const log = (tag: string, payload: unknown) => console.log(`PHASE0_RESULT ${tag} ${JSON.stringify(payload)}`);
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

function deviceInfo() {
  const c = Platform.constants as Record<string, unknown>;
  return {
    os: Platform.OS,
    osVersion: String(c.Release ?? Platform.Version),
    model: String(c.Model ?? c.systemName ?? 'unknown'),
    brand: String(c.Brand ?? ''),
    isEmulator: String(c.Fingerprint ?? '').includes('generic') || String(c.Model ?? '').includes('sdk'),
    ramMb: Math.round(memSnapshot().deviceTotalMb),
  };
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [threads, setThreads] = useState(AUTORUN ? AUTORUN_THREADS : 2);
  const loadedThreads = useRef(0);
  const [status, setStatus] = useState('idle');
  const [files, setFiles] = useState(listModelFiles());
  const engine = useRef<OnDeviceDecimaEngine | null>(null);
  const [loadInfo, setLoadInfo] = useState<string>('');
  const [state, setState] = useState(
    'Claim: Breaking news: September 10 start na Facebook ban na sa Pinas. Meron na penalty.\nEvidence: There is no official government announcement confirming a nationwide ban starting September 10 or any penalty for Facebook use in the Philippines.',
  );
  const [question, setQuestion] = useState('Does the evidence support the claim?');
  const [options, setOptions] = useState('supports, contradicts, unrelated');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [bench, setBench] = useState<BenchReport | null>(null);
  const [fixtures, setFixtures] = useState<FixtureReport | null>(null);
  const [llmReports, setLlmReports] = useState<LlmFixtureReport[]>([]);
  const appleLlm = appleLlmAvailability();
  const busy = status.endsWith('…');

  async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setStatus(`${label}…`);
    try {
      const out = await fn();
      setStatus(`${label}: done`);
      return out;
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      setStatus(`${label}: FAILED ${msg.slice(0, 400)}`);
      log('error', { step: label, message: msg });
      return undefined;
    }
  }

  const download = () =>
    step('download', async () => {
      const out = await downloadModel(baseUrl, (f) => setStatus(`download ${f}…`));
      setFiles(out);
      log('files', out);
    });

  const load = (n = threads) =>
    step(`load (${n} threads)`, async () => {
      await engine.current?.release();
      engine.current = null;
      const mem0 = memSnapshot();
      const e = await OnDeviceDecimaEngine.load({
        ort,
        modelDir: modelDir().uri,
        readText,
        sessionPath,
        sessionOptions: { intraOpNumThreads: n, interOpNumThreads: 1, graphOptimizationLevel: 'all', executionProviders: ['cpu'] },
      });
      engine.current = e;
      loadedThreads.current = n;
      const mem1 = memSnapshot();
      const info = { threads: n, timings: e.loadTimings, graph: e.graphInfo, memBefore: mem0, memAfter: mem1 };
      setLoadInfo(
        `cold load ${fmt(e.loadTimings.totalMs, 0)} ms (read ${fmt(e.loadTimings.readFilesMs, 0)} · parse ${fmt(e.loadTimings.tokenizerParseMs, 0)} · tokenizer ${fmt(e.loadTimings.tokenizerMs, 0)} · encoder ${fmt(e.loadTimings.encoderMs, 0)} · scorer ${fmt(e.loadTimings.scorerMs, 0)} · wait ${fmt(e.loadTimings.sessionWaitMs, 0)})\n` +
          `encoder ${e.graphInfo.encoder.inputNames.join(',')} → ${e.graphInfo.encoder.outputNames.join(',')}\n` +
          `scorer ${e.graphInfo.scorer.inputNames.join(',')} → ${e.graphInfo.scorer.outputNames.join(',')}\n` +
          `RSS ${fmt(mem0.rssMb, 0)} → ${fmt(mem1.rssMb, 0)} MB, PSS ${fmt(mem1.pssMb, 0)} MB`,
      );
      log('load', info);
      return e;
    });

  const decideOnce = () =>
    step('decide', async () => {
      if (!engine.current) throw new Error('load the model first');
      const choices = options.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const d = await engine.current.decide(state, { text: question, choices, kind: 'choose' });
      setDecision(d);
      log('decide', d);
    });

  const runBench = () =>
    step('benchmark', async () => {
      if (!engine.current) throw new Error('load the model first');
      const b = await benchmark(engine.current, 50);
      setBench(b);
      log('bench', { threads: loadedThreads.current, ...b });
      return b;
    });

  const runFixtureSuite = () =>
    step('fixtures', async () => {
      if (!engine.current) throw new Error('load the model first');
      const f = await runFixtures(engine.current);
      setFixtures(f);
      // logcat cuts lines at ~4 KB: summary first, then one line per item
      const { items, ...summary } = f;
      log('fixtures', { threads: loadedThreads.current, ...summary });
      items.forEach((r) => log('fixture', r));
      return f;
    });

  const runLlmSuite = (mode: 'one-step' | 'two-step') =>
    step(`apple llm ${mode}`, async () => {
      const engine = new LlmDecisionEngine({ backend: appleLlmBackend({ permissive: true }), domainInstructions: FACT_CHECK_INSTRUCTIONS });
      const r = await runLlmFixtures(engine, mode);
      setLlmReports((prev) => [...prev.filter((x) => x.mode !== mode), r]);
      const { items, ...summary } = r;
      log('llm', summary);
      items.forEach((it) => log('llm-item', { mode, ...it }));
      return r;
    });

  useEffect(() => {
    log('device', deviceInfo());
    if (!AUTORUN) return;
    if (AUTORUN_ENGINE === 'apple') {
      (async () => {
        log('apple-llm', appleLlm);
        await runLlmSuite('one-step');
        await runLlmSuite('two-step');
        log('autorun', 'complete');
      })();
      return;
    }
    (async () => {
      // one thread count per fresh process, so cold load and memory are not polluted by earlier loads
      if (!modelPresent()) await download();
      if (await load(AUTORUN_THREADS)) {
        await runBench();
        await runFixtureSuite();
      }
      log('autorun', 'complete');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <StatusBar style="auto" />
      <Text style={styles.h1}>Phase 0 · Decima on device</Text>
      <Text style={styles.mono}>{JSON.stringify(deviceInfo())}</Text>
      <Text style={[styles.status, status.includes('FAILED') && styles.bad]}>{status}</Text>

      <Text style={styles.h2}>Model files</Text>
      <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" />
      {files.map((f) => (
        <Text key={f.name} style={styles.mono}>
          {f.name}: {f.bytes === null ? 'missing' : `${(f.bytes / 1048576).toFixed(2)} MB`}
        </Text>
      ))}
      <View style={styles.row}>
        <Button title="Download" onPress={download} disabled={busy} />
        {THREADS.map((n) => (
          <Button key={n} title={`${n}T${n === threads ? '✓' : ''}`} onPress={() => setThreads(n)} disabled={busy} />
        ))}
        <Button title="Load" onPress={() => load()} disabled={busy} />
      </View>
      {!!loadInfo && <Text style={styles.mono}>{loadInfo}</Text>}

      <Text style={styles.h2}>Single decision</Text>
      <TextInput style={[styles.input, styles.multi]} value={state} onChangeText={setState} multiline />
      <TextInput style={styles.input} value={question} onChangeText={setQuestion} />
      <TextInput style={styles.input} value={options} onChangeText={setOptions} />
      <Button title="Decide" onPress={decideOnce} disabled={busy} />
      {decision && (
        <Text style={styles.mono}>
          {decision.choices.map((c, i) => `${c}: ${decision.probs[i].toFixed(4)}`).join('\n')}
          {`\n${fmt(decision.timings.totalMs)} ms (tok ${fmt(decision.timings.tokenizeMs)} · choices ${fmt(decision.timings.encodeChoicesMs)} · state ${fmt(decision.timings.encodeStateMs)} · score ${fmt(decision.timings.scoreMs)})`}
        </Text>
      )}

      <Text style={styles.h2}>Benchmark (first + 50 warm)</Text>
      <Button title="Run benchmark" onPress={runBench} disabled={busy} />
      {bench && (
        <Text style={styles.mono}>
          {`first ${fmt(bench.firstMs)} ms · median ${fmt(bench.medianMs)} ms · p95 ${fmt(bench.p95Ms)} ms\n`}
          {`stages: tok ${fmt(bench.meanStageMs.tokenize)} · state ${fmt(bench.meanStageMs.encodeState)} · score ${fmt(bench.meanStageMs.score)} ms\n`}
          {`peak RSS ${fmt(bench.memory.after.peakRssMb, 0)} MB (reset ${bench.memory.peakReset}) · max PSS ${fmt(bench.memory.maxPssMb, 0)} MB`}
        </Text>
      )}

      <Text style={styles.h2}>Apple on-device model</Text>
      <Text style={styles.mono}>{`available: ${appleLlm.available} (${appleLlm.reason})`}</Text>
      <View style={styles.row}>
        <Button title="LLM fixtures 1-step" onPress={() => runLlmSuite('one-step')} disabled={busy || !appleLlm.available} />
        <Button title="LLM fixtures 2-step" onPress={() => runLlmSuite('two-step')} disabled={busy || !appleLlm.available} />
      </View>
      {llmReports.map((r) => (
        <View key={r.mode}>
          <Text style={styles.mono}>
            {`${r.mode}: ${Object.entries(r.accuracy).map(([l, a]) => `${l} ${a.correct}/${a.total}`).join(' · ')} · flips ${r.orderFlips} · refusals ${r.refusals} · median ${fmt(r.latencyMs.median, 0)} ms · p95 ${fmt(r.latencyMs.p95, 0)} ms`}
          </Text>
          {r.items.map((it) => (
            <Text key={it.id} style={[styles.mono, !it.correct && styles.dim]}>
              {`${it.id} ${it.label.padEnd(11)} → ${it.answer.padEnd(11)}${it.orderFlip ? ' FLIP' : ''}${it.errors.length ? ` ERR×${it.errors.length}` : ''}`}
            </Text>
          ))}
        </View>
      ))}

      <Text style={styles.h2}>Fixtures (20 × 3 orders)</Text>
      <Button title="Run fixtures" onPress={runFixtureSuite} disabled={busy} />
      {fixtures && (
        <View>
          <Text style={styles.mono}>
            {`tokenizer mismatches ${fixtures.tokenizerMismatches} (+${fixtures.edgeCaseMismatches} edge) · max Δp ${fixtures.maxDelta.toExponential(2)} · order flips ${fixtures.orderFlips}\n`}
            {Object.entries(fixtures.accuracy).map(([l, a]) => `${l} ${a.correct}/${a.total}`).join(' · ')}
          </Text>
          {fixtures.items.map((r) => (
            <Text key={r.id} style={[styles.mono, !r.correct && styles.dim]}>
              {`${r.id} ${r.label.padEnd(11)} → ${r.answer.padEnd(11)} Δ${r.maxDelta.toExponential(1)}${r.tokenizerMatch ? '' : ' TOK✗'}${r.orderFlip ? ' FLIP' : ''}`}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 56, gap: 8 },
  h1: { fontSize: 20, fontWeight: '700' },
  h2: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  status: { fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }), fontSize: 12 },
  bad: { color: '#b00020' },
  dim: { opacity: 0.55 },
  mono: { fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }), fontSize: 11 },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 6, padding: 8, fontSize: 13 },
  multi: { minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
});
