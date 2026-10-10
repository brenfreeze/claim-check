/**
 * @jest-environment ./jest.ort-env.js
 */
// Real-model check of the offline matcher: ft3 int8 on onnxruntime-node against the bundled corpus. Not part of the
// default suite (run: npx jest --testMatch '**/*.eval.ts'); skips when models/ is absent.
import * as fs from 'fs';
import * as ort from 'onnxruntime-node';
import * as path from 'path';
import { OnDeviceDecimaEngine } from '../../engine/OnDeviceDecimaEngine';
import { loadBundledCorpus } from '../corpus';
import { OfflineMatcher } from '../matchOffline';

const ROOT = path.resolve(__dirname, '../../..');
const MODEL_DIR = path.join(ROOT, 'models/finetune/ft3/onnx-int8');
const readText = async (p: string) => fs.readFileSync(p, 'utf8');

type Expect = 'match' | 'opposite' | 'none';
// target: a regex on the fact-checked claim the post should match (null for novel claims)
const ITEMS: { post: string; target: RegExp | null; expect: Expect; lang: string }[] = [
  { post: 'WALANG PASOK sa buong bansa sa July 27 dahil sa SONA ni PBBM, sabi ng Malacañang!', target: /class suspensions nationwide on July 27/, expect: 'match', lang: 'taglish' },
  { post: 'Suspended daw ang klase from March 9 to 13 dahil sa pagtaas ng presyo ng langis', target: /Classes are suspended from March 9 to 13/, expect: 'match', lang: 'taglish' },
  { post: 'Makakatanggap na raw ng 13th month pension ang mga SSS pensioners kasabay ng March pension!', target: /SSS\) pensioners can expect to receive their 13th month/, expect: 'match', lang: 'taglish' },
  { post: 'May P5,000 Christmas bonus daw para sa 4Ps members at kahit hindi member, mag-register lang online', target: /P5,000 Christmas bonus/, expect: 'match', lang: 'taglish' },
  { post: 'Super Typhoon Enteng is now Signal No. 4!! Stay safe everyone', target: /Enteng is now Signal No\. 4/, expect: 'match', lang: 'en' },
  { post: "Poul Thorsen's guilty plea proves that vaccines cause autism.", target: /Thorsen/, expect: 'match', lang: 'en' },
  { post: 'SSS pensioners will NOT get their 13th month benefit together with the March 2026 pension.', target: /SSS\) pensioners can expect to receive their 13th month/, expect: 'opposite', lang: 'en' },
  { post: 'Libre na ang sakay sa MRT para sa lahat ng estudyante simula Lunes.', target: null, expect: 'none', lang: 'tl' },
  { post: 'Magkakaroon ng brownout sa buong Cebu City sa Sabado mula 8am hanggang 5pm.', target: null, expect: 'none', lang: 'tl' },
  { post: 'PAGASA will open a new weather radar station in Batanes next year.', target: null, expect: 'none', lang: 'en' },
];

const d = fs.existsSync(path.join(MODEL_DIR, 'encoder.onnx')) ? describe : describe.skip;

d('offline matcher on ft3 (real model)', () => {
  test('report', async () => {
    const engine = await OnDeviceDecimaEngine.load({ ort, modelDir: MODEL_DIR, readText, sessionOptions: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
    const { debunks } = loadBundledCorpus();
    const matcher = new OfflineMatcher(debunks);
    const rows: string[] = [];
    for (const it of ITEMS) {
      const m = await matcher.match(it.post, engine, 0);
      const inTop = it.target ? m.candidates.some((c) => it.target!.test(c.debunk.claim)) : null;
      const target = it.target ? m.candidates.find((c) => it.target!.test(c.debunk.claim)) : undefined;
      const best = [...m.candidates].sort((a, b) => (b.probs?.supports ?? 0) - (a.probs?.supports ?? 0))[0];
      const fmt = (p?: Record<string, number>) => (p ? `s${p.supports.toFixed(2)} c${p.contradicts.toFixed(2)} u${p.unrelated.toFixed(2)}` : '—');
      rows.push(
        [
          it.expect.padEnd(8), it.lang.padEnd(7), `top8:${inTop === null ? '-' : inTop ? 'Y' : 'N'}`,
          `target j${target?.jaccard.toFixed(2) ?? '-'} ${fmt(target?.probs)}`, `best j${best?.jaccard.toFixed(2) ?? '-'} ${fmt(best?.probs)} ${best?.debunk.claim.slice(0, 50) ?? ''}`,
          `${m.decisions}d ${m.ms}ms`, `| ${it.post.slice(0, 60)}`,
        ].join('  '),
      );
    }
    console.log(rows.join('\n'));
    await engine.release();
  });
});
