# Phase 0 results: on-device Decima spike

2026-10-09 · Bren Aviador · run on an Android emulator. No physical phone was available.

**Decision: the on-device engine works, with conditions. The model's Taglish quality fails, and that changes the product.**
Decima-small runs on device and matches Python. Warm decisions are fast. Cold load now meets the 3 s target on the emulator (1.5–1.7 s, was 3.5–4.1 s), and peak memory still needs a measurement on a release build. Accuracy is the blocker: on the 20 fixtures the model gets 5/10 English and 4/10 Taglish (targets ≥ 7 and ≥ 6), and it never once answers "supports". No engine swap fixes that, so the next decision is about the model or the task, not the runtime.

## Results

Device: `sdk_gphone64_arm64` emulator, Android 17 (API 37), 4 vCPU on an Apple M1 Pro host, 3.9 GB RAM. Expo SDK 57 / RN 0.86.3 / Hermes, debug dev-client build. onnxruntime-react-native 1.24.3 JS binding with the `onnxruntime-android` 1.31.0 native runtime. Each thread count ran in a fresh process.

| Measure | Target | Result |
| --- | --- | --- |
| Tokenizer mismatches | 0 | **0**, on Hermes on device, Hermes on the laptop, and Node (60 fixture runs plus 22 edge cases) |
| Max probability delta vs Python | ≤ 0.02 | **0.0154** on device (tl-03). This is entirely the ORT version: the device equals Python on ORT 1.31 to 4 decimals. Node vs Python on the same ORT 1.24: 9e-8 |
| Order-change flips | 0 | **0** (20 fixtures × 3 option orders, on device and in Python) |
| Accuracy, English (of 10) | ≥ 7 | **5** ✗ |
| Accuracy, Taglish (of 10) | ≥ 6 | **4** ✗ |
| Median / p95 warm decision | ≤ 150 / ≤ 300 ms | **21 / 71 ms** at 2 threads (1T 31 / 66, 4T 35 / 78). Before the cold-load fix: 32 / 130 ms. That gain is mostly native `encodeState`, which this work didn't change, so it's likely run-to-run/host variance rather than an effect of the fix |
| Cold load | ≤ 3 s | **1.5–1.7 s** ✓ (2T 1.6 s; before the fix 3.5–4.1 s, 2T 3.5 s): file read 0.8–1.1 s, tokenizer build 0.4–0.6 s (was 2.1–2.6 s). Both ORT sessions now build alongside them |
| Peak memory | ≤ 500 MB | **Engine adds 0.25–0.28 GB PSS** (was ~0.32 GB). The whole debug process peaks at 0.49–0.51 GB PSS (dumpsys; was 0.56–0.57) / 0.63–0.66 GB RSS (VmHWM; was 0.70). The debug build's baseline is 0.23 GB PSS before load, so a release build still needs measuring |

Per thread count after the cold-load fix (`scripts/summarize-device.py`; raw logs in `results/device/`). Encoder and scorer are now "load start → session ready" and overlap the read and tokenizer stages, so the stages don't sum to the total. Read + parse + tokenizer equals the total in every run, so the JS thread is the critical path. The encoder's ready time can't be stamped until that thread frees up, so it reads as the total.

| Threads | Cold load ms (read / parse / tokenizer / encoder / scorer) | First ms | Median ms | p95 ms | Peak RSS MB (VmHWM, bench) | Max PSS MB (in-app / dumpsys) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1746 (1087 / 223 / 436 / 1746 / 433) | 135 | 31.0 | 65.9 | 655 | 517 / 510 |
| 2 | 1596 (844 / 161 / 591 / 1596 / 299) | 121 | 21.4 | 70.6 | 627 | 484 / 491 |
| 4 | 1451 (897 / 123 / 432 / 1451 / 509) | 321 | 35.1 | 78.4 | 627 | 482 / 486 |

Engine memory at load (`memBefore` → `memAfter`): 1T +279 MB RSS / +279 MB PSS, 2T +254 / +253, 4T +249 / +248. Before the fix: +308 / +315, +338 / +337, +323 / +322.

Host contention: none. A fine-tune run (`harness/finetune.py`) was using the host CPU/GPU until 21:27; this protocol started after it exited, and `pgrep -fl finetune` was empty before and after the run.

The laptop reference (Python, ORT 1.24.4, 1 thread on the M1 Pro) gives a median of 23.8 ms and a p95 of 27.1 ms. Each M1 host core is faster than a mid-range phone core, so expect real-phone latency and cold load to be roughly 2–3× the emulator's. That still clears 150 ms median, but it would put cold load at roughly 3–5 s, so the 3 s target may still fail on a phone. Running this on a real phone is the first Phase 1 task.

### Before the cold-load fix

Commit c113692, before the trie-free tokenizer patch and the overlapped session creation. Stages were sequential and summed to the total.

| Threads | Cold load ms (read / parse / tokenizer / encoder / scorer) | First ms | Median ms | p95 ms | Peak RSS MB | Max PSS MB (in-app / dumpsys) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4120 (805 / 142 / 2488 / 648 / 36) | 140 | 42.6 | 80.3 | 697 | 554 / 555 |
| 2 | 3529 (748 / 144 / 2129 / 462 / 45) | 90 | 31.9 | 130.0 | 708 | 568 / 569 |
| 4 | 3929 (679 / 146 / 2623 / 447 / 33) | 118 | 33.6 | 102.1 | 705 | 564 / 565 |

## Answers to the six questions

1. **Does the int8 model run under onnxruntime-react-native in an Expo dev build?** Yes, after two integration fixes, both recorded in the repo:
   - onnxruntime-react-native 1.24.3's `build.gradle` uses `VersionNumber`, which Gradle 9 removed. It's patched in `patches/` via patch-package.
   - Its legacy `unimodule.json` makes Expo autolinking skip it on Android, so `NativeModules.Onnxruntime` was null. The fix is a `react-native.config.js` that declares its Android platform.

   The encoder needs the `com.microsoft:MatMulNBits` contrib op, which the full `onnxruntime-android` AAR has.
2. **Does the XLM-R tokenizer run in React Native?** Yes, in JS with `@huggingface/tokenizers` 0.2.0, which needs no polyfills. It matches HF transformers exactly on Node, on Hermes on the laptop, and on Hermes on device. The cost is load time. Building the Unigram model from the 17 MB `tokenizer.json` took 2.1–2.6 s on the emulator. It now takes 0.4–0.6 s, because `patches/@huggingface+tokenizers+0.2.0.patch` drops the 250k-piece CharTrie build.
3. **Is option scoring in the graph?** Yes. Late interaction lives in `scorer.onnx`, which takes the state and choice token states and returns a score per choice plus a `z` vector. Ported to TypeScript: input templating (`query: {question}\n{state}` and `passage: {question} {option}`, NFC normalization, Python-style `strip`, plus the long-question rendering), temperature 0.9356, softmax, the ordinal head for `score`, and the System One mapping and rounding.
4. **Do on-device probabilities match Python?** Yes: max Δ is 0.0154 against Python on ORT 1.24 and 0.0000 against Python on ORT 1.31, the version the Android runtime actually resolved to. Separately, Decima's own batched `system_one` path drifts from its single-decision path by up to 0.006, because padding changes the int8 encoder output. The engine follows the single-decision path.
5. **Latency, cold load and memory?** See the tables above. Latency passes comfortably. Cold load passes on the emulator: 1.6 s at 2 threads (≤ 3 s), down from 3.5 s. Now the file read is the main cost. Memory is 0.25–0.28 GB for the engine on top of the app, down from about 0.32 GB.
6. **Is Taglish accuracy good enough?** No. See below.

## Accuracy detail

The model labels almost everything "unrelated". It gets 0 of 6 "supports" items right and 3 of 8 "contradicts". Every "unrelated" item is correct, which accounts for 6 of the 9 points.

| Item | Language | Label | Decima | P(sup / con / unr) | |
| --- | --- | --- | --- | --- | --- |
| en-01 | English | contradicts | contradicts | 0.06 / 0.57 / 0.36 | ✓ |
| en-02 | English | contradicts | contradicts | 0.02 / 0.77 / 0.21 | ✓ |
| en-03 | English | contradicts | unrelated | 0.03 / 0.23 / 0.73 | ✗ |
| en-04 | English | contradicts | unrelated | 0.02 / 0.26 / 0.71 | ✗ |
| en-05 | English | supports | unrelated | 0.04 / 0.14 / 0.82 | ✗ |
| en-06 | English | supports | unrelated | 0.03 / 0.05 / 0.91 | ✗ |
| en-07 | English | supports | unrelated | 0.05 / 0.04 / 0.91 | ✗ |
| en-08 | English | unrelated | unrelated | 0.02 / 0.07 / 0.91 | ✓ |
| en-09 | English | unrelated | unrelated | 0.03 / 0.19 / 0.78 | ✓ |
| en-10 | English | unrelated | unrelated | 0.02 / 0.10 / 0.88 | ✓ |
| tl-01 | Taglish | contradicts | contradicts | 0.08 / 0.48 / 0.44 | ✓ |
| tl-02 | Taglish | contradicts | unrelated | 0.02 / 0.17 / 0.81 | ✗ |
| tl-03 | Filipino | contradicts | unrelated | 0.25 / 0.21 / 0.54 | ✗ |
| tl-04 | Taglish | contradicts | unrelated | 0.03 / 0.13 / 0.84 | ✗ |
| tl-05 | Taglish | supports | unrelated | 0.16 / 0.30 / 0.54 | ✗ |
| tl-06 | Taglish | supports | unrelated | 0.04 / 0.17 / 0.79 | ✗ |
| tl-07 | Taglish | supports | unrelated | 0.11 / 0.16 / 0.73 | ✗ |
| tl-08 | Filipino | unrelated | unrelated | 0.03 / 0.05 / 0.92 | ✓ |
| tl-09 | Taglish | unrelated | unrelated | 0.05 / 0.08 / 0.86 | ✓ |
| tl-10 | Filipino | unrelated | unrelated | 0.06 / 0.09 / 0.85 | ✓ |

Rewording the question doesn't rescue it (`harness/prompt_variants.py`, same 20 items). Decima's training-time NLI rendering (`Premise:` / `Hypothesis:`, entailment / neutral / contradiction) and descriptive option criteria both peak at 6/10 English and stay at 4/10 Taglish.

Caveats: n = 20, and I drafted the labels from Rappler and VERA Files fact-checks. **Bren still has to review them** (`fixtures/phase0.json` → `reviewStatus`). Evidence excerpts are verbatim and verified against their source pages. Thirteen claims are paraphrases and are marked as such; seven are quoted verbatim from their source pages.

## What Phase 1 inherits

- `src/engine/`: the `DecisionEngine` contract from the parent PRD, `OnDeviceDecimaEngine` (ORT injected, so the same class runs on Node and React Native), the tokenizer, input rendering, post-processing, the System One mapping, and `release()`. Jest: 421 tests (`npm test`), covering SP-03 to SP-06 and SP-10 against `fixtures/phase0.reference.json`.
- `fixtures/phase0.json`, plus the Python reference harness `harness/export_reference.py` (`npm run reference`).
- `patches/onnxruntime-react-native+1.24.3.patch` and `react-native.config.js`, both needed for any Android build.
- `patches/@huggingface+tokenizers+0.2.0.patch` (trie-free Unigram), version-locked to 0.2.0 (both patched packages are pinned exactly in `package.json`). It is what takes the tokenizer build from 2.1–2.6 s to 0.4–0.6 s on the emulator. Re-run `scripts/hermes-tokenizer-parity.sh` after any tokenizer upgrade; a Jest guard fails if the patch is not applied.

## Conditions and open items

1. **Model quality (blocks the product).** Decide what changes, since the runtime isn't the problem. Options:
   - try another checkpoint (e.g. `decima-agent`) or fine-tune on PH claim–evidence pairs;
   - split the verdict into separate `noul` questions;
   - run verdicts on a stronger engine and keep Decima for routing.

   First grow the fixture set beyond 20 items and confirm the labels.
2. **Cold load: met on the emulator.** It's 1.6 s at 2 threads (1.5–1.7 s across 1/2/4), against ≤ 3 s, down from 3.5 s. Re-measure on a real phone, where 2–3× would put it at about 3–5 s. If it misses there, build the engine at app start in the background, or ship a compact vocab instead of the 17 MB `tokenizer.json` to cut the 0.8–1.1 s read.
3. **Pin `onnxruntime-android`.** The RN package resolves `latest.integration`, so the native runtime can change under the app between builds.
4. **Memory.** Measure a release build on a real mid-range phone.
5. **iOS.** Untested: no Xcode and no paid Apple account. The `mem-probe` Swift code and the ORT pod path haven't been compiled yet.
6. **License.** Some Decima training data is CC BY-NC (ANLI, XNLI, multilingual-NLI-26lang, per the model card). Check this against the hackathon's terms.

## Reproduce

```bash
npm install                         # applies both patches (onnxruntime-react-native, @huggingface/tokenizers)
uvx --from 'huggingface_hub[cli]' hf download amyrmahdy/decima-small --include 'onnx/int8/*' --local-dir models/decima-small
npm run reference                   # Python reference → fixtures/phase0.reference.json
npm test                            # engine vs reference on onnxruntime-node
npx expo prebuild --platform android && (cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
python3 -m http.server 8765 --bind 127.0.0.1 --directory models/decima-small/onnx/int8 &
scripts/run-device-protocol.sh 1 2 4 && python3 scripts/summarize-device.py
```
