/**
 * @jest-environment ./jest.ort-env.js
 */
// Demo posts through the same path as the app (claim sentences → OfflineMatcher on ft3, gate 0.85). Run:
// npx jest --testMatch '**/demoPosts.eval.ts'. Skips when models/ is absent.
import * as fs from 'fs';
import * as ort from 'onnxruntime-node';
import * as path from 'path';
import { mockClaimScore, splitSentences } from '../../core/text';
import { OnDeviceDecimaEngine } from '../../engine/OnDeviceDecimaEngine';
import { loadBundledCorpus } from '../corpus';
import { OfflineMatcher } from '../matchOffline';

const MODEL_DIR = path.resolve(__dirname, '../../../models/finetune/ft3/onnx-int8');
export const DEMO_POSTS = [
  'BREAKING!!! Wala nang Grade 11 at 12 simula June 2027, inanunsyo na ng DepEd! Sayang lang pala ang dalawang taon ng mga anak natin. I-share para malaman ng lahat!',
  'May P20,000 cash aid daw ang SSS para sa mga nawalan ng trabaho sa ilalim ng Calamity Loan Assistance. Mag-apply na bago maubos ang slots!!!',
  'Libreng kuryente para sa lahat ng may national ID o vaccine card! Mag-register lang online at may subsidy ka pa. Totoo ito, nakita ko sa balita.',
  'GRABE! Ilalabas na raw ng ICC si Duterte ngayong linggo, kinumpirma ng isang opisyal ng International Criminal Court! Uuwi na si Tatay Digong!',
  'Mga ka-barangay, magkakaroon ng libreng bigas na 25 kilos sa bawat pamilya sa Quezon City ngayong Sabado sa covered court. Dalhin ang barangay ID.',
];
const d = fs.existsSync(path.join(MODEL_DIR, 'encoder.onnx')) ? describe : describe.skip;
d('demo posts on ft3', () => {
  test('report', async () => {
    const engine = await OnDeviceDecimaEngine.load({ ort, modelDir: MODEL_DIR, readText: async (p: string) => fs.readFileSync(p, 'utf8'), sessionOptions: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
    const matcher = new OfflineMatcher(loadBundledCorpus().debunks);
    const out: string[] = [];
    for (const post of DEMO_POSTS) {
      out.push(`\nPOST: ${post.slice(0, 70)}…`);
      for (const s of splitSentences(post).filter((x) => mockClaimScore(x) >= 0.5)) {
        const m = await matcher.match(s, engine, 0.85);
        const c = m.candidates.find((x) => x.debunk === m.debunk);
        out.push(`  j=${c ? c.jaccard.toFixed(2) : '-'}` + `  ${m.verdict.padEnd(12)} ${m.confidence.toFixed(2)} ${m.debunk ? `${m.debunk.publisher} [${m.debunk.rating}] ${m.debunk.claim.slice(0, 60)}` : m.reason}  | ${s.slice(0, 60)}`);
      }
    }
    console.log(out.join('\n'));
    await engine.release();
  });
});
