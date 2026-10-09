# Phase 0 results: on-device Decima spike

2026-10-09 · Bren Aviador · run on an Android emulator. No physical phone was available.

**Decision: the on-device engine works, with conditions. The model's Taglish quality fails, and that changes the product.**
Decima-small runs on device and matches Python. Warm decisions are fast. Cold load (3.5–4.1 s) is over the 3 s target, and peak memory still needs a measurement on a release build. Accuracy is the blocker: on the 20 fixtures the model gets 5/10 English and 4/10 Taglish (targets ≥ 7 and ≥ 6), and it never once answers "supports". No engine swap fixes that, so the next decision is about the model or the task, not the runtime.

## Results

Device: `sdk_gphone64_arm64` emulator, Android 17 (API 37), 4 vCPU on an Apple M1 Pro host, 3.9 GB RAM. Expo SDK 57 / RN 0.86.3 / Hermes, debug dev-client build. onnxruntime-react-native 1.24.3 JS binding with the `onnxruntime-android` 1.31.0 native runtime. Each thread count ran in a fresh process.

| Measure | Target | Result |
| --- | --- | --- |
| Tokenizer mismatches | 0 | **0**, on Hermes on device, Hermes on the laptop, and Node (60 fixture runs plus 22 edge cases) |
| Max probability delta vs Python | ≤ 0.02 | **0.0154** on device (tl-03). This is entirely the ORT version: the device equals Python on ORT 1.31 to 4 decimals. Node vs Python on the same ORT 1.24: 9e-8 |
| Order-change flips | 0 | **0** (20 fixtures × 3 option orders, on device and in Python) |
| Accuracy, English (of 10) | ≥ 7 | **5** ✗ |
| Accuracy, Taglish (of 10) | ≥ 6 | **4** ✗ |
| Median / p95 warm decision | ≤ 150 / ≤ 300 ms | **32 / 130 ms** at 2 threads (1T 43 / 80, 4T 34 / 102) |
| Cold load | ≤ 3 s | **3.5–4.1 s** ✗ (2T 3.5 s): tokenizer build 2.1–2.6 s, file read 0.7–0.8 s, encoder session 0.45–0.65 s |
| Peak memory | ≤ 500 MB | **Engine adds ~0.32 GB PSS**. The whole debug process peaks at 0.56–0.57 GB PSS (dumpsys) / 0.70 GB RSS (VmHWM). The debug build's baseline is 0.23 GB PSS before load, so a release build still needs measuring |

Per thread count (`scripts/summarize-device.py`; raw logs in `results/device/`):

| Threads | Cold load ms (read / parse / tokenizer / encoder / scorer) | First ms | Median ms | p95 ms | Peak RSS MB | Max PSS MB (in-app / dumpsys) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4120 (805 / 142 / 2488 / 648 / 36) | 140 | 42.6 | 80.3 | 697 | 554 / 555 |
| 2 | 3529 (748 / 144 / 2129 / 462 / 45) | 90 | 31.9 | 130.0 | 708 | 568 / 569 |
| 4 | 3929 (679 / 146 / 2623 / 447 / 33) | 118 | 33.6 | 102.1 | 705 | 564 / 565 |

The laptop reference (Python, ORT 1.24.4, 1 thread on the M1 Pro) gives a median of 23.8 ms and a p95 of 27.1 ms. Each M1 host core is faster than a mid-range phone core, so expect real-phone latency and cold load to be roughly 2–3× the emulator's. That still clears 150 ms median but pushes cold load further over 3 s. Running this on a real phone is the first Phase 1 task.

## Answers to the six questions

1. **Does the int8 model run under onnxruntime-react-native in an Expo dev build?** Yes, after two integration fixes, both recorded in the repo:
   - onnxruntime-react-native 1.24.3's `build.gradle` uses `VersionNumber`, which Gradle 9 removed. It's patched in `patches/` via patch-package.
   - Its legacy `unimodule.json` makes Expo autolinking skip it on Android, so `NativeModules.Onnxruntime` was null. The fix is a `react-native.config.js` that declares its Android platform.

   The encoder needs the `com.microsoft:MatMulNBits` contrib op, which the full `onnxruntime-android` AAR has.
2. **Does the XLM-R tokenizer run in React Native?** Yes, in JS with `@huggingface/tokenizers` 0.2.0, which needs no polyfills. It matches HF transformers exactly on Node, on Hermes on the laptop, and on Hermes on device. The cost is load time: about 2.1–2.6 s on the emulator to build the Unigram model from the 17 MB `tokenizer.json`.
3. **Is option scoring in the graph?** Yes. Late interaction lives in `scorer.onnx`, which takes the state and choice token states and returns a score per choice plus a `z` vector. Ported to TypeScript: input templating (`query: {question}\n{state}` and `passage: {question} {option}`, NFC normalization, Python-style `strip`, plus the long-question rendering), temperature 0.9356, softmax, the ordinal head for `score`, and the System One mapping and rounding.
4. **Do on-device probabilities match Python?** Yes: max Δ is 0.0154 against Python on ORT 1.24 and 0.0000 against Python on ORT 1.31, the version the Android runtime actually resolved to. Separately, Decima's own batched `system_one` path drifts from its single-decision path by up to 0.006, because padding changes the int8 encoder output. The engine follows the single-decision path.
5. **Latency, cold load and memory?** See the tables above. Latency passes comfortably. Cold load fails, and the tokenizer build is the main cost. Memory is about 0.32 GB for the engine on top of the app.
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

- `src/engine/`: the `DecisionEngine` contract from the parent PRD, `OnDeviceDecimaEngine` (ORT injected, so the same class runs on Node and React Native), the tokenizer, input rendering, post-processing, the System One mapping, and `release()`. Jest: 416 tests (`npm test`), covering SP-03 to SP-06 and SP-10 against `fixtures/phase0.reference.json`.
- `fixtures/phase0.json`, plus the Python reference harness `harness/export_reference.py` (`npm run reference`).
- `patches/onnxruntime-react-native+1.24.3.patch` and `react-native.config.js`, both needed for any Android build.

## Conditions and open items

1. **Model quality (blocks the product).** Decide what changes, since the runtime isn't the problem. Options:
   - try another checkpoint (e.g. `decima-agent`) or fine-tune on PH claim–evidence pairs;
   - split the verdict into separate `noul` questions;
   - run verdicts on a stronger engine and keep Decima for routing.

   First grow the fixture set beyond 20 items and confirm the labels.
2. **Cold load.** Build the tokenizer once at app start in the background, or ship a pre-processed compact vocab instead of the 17 MB `tokenizer.json`. Re-measure on a real phone.
3. **Pin `onnxruntime-android`.** The RN package resolves `latest.integration`, so the native runtime can change under the app between builds.
4. **Memory.** Measure a release build on a real mid-range phone.
5. **iOS.** Untested: no Xcode and no paid Apple account. The `mem-probe` Swift code and the ORT pod path haven't been compiled yet.
6. **License.** Some Decima training data is CC BY-NC (ANLI, XNLI, multilingual-NLI-26lang, per the model card). Check this against the hackathon's terms.

## Reproduce

```bash
npm install                         # applies the onnxruntime-react-native patch
uvx --from 'huggingface_hub[cli]' hf download amyrmahdy/decima-small --include 'onnx/int8/*' --local-dir models/decima-small
npm run reference                   # Python reference → fixtures/phase0.reference.json
npm test                            # engine vs reference on onnxruntime-node
npx expo prebuild --platform android && (cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
python3 -m http.server 8765 --bind 127.0.0.1 --directory models/decima-small/onnx/int8 &
scripts/run-device-protocol.sh 1 2 4 && python3 scripts/summarize-device.py
```
