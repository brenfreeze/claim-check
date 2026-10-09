# Handoff: claim-check, Phase 0 → Phase 1

2026-10-10 · picked up from session "claim-check-main". Read this first, then `docs/phase0-results.md` and `docs/phase0-finetune.md`.

## Where we are in one paragraph

Phase 0 asked whether Decima-small can make one correct, fast Choice decision on a phone.
- **The runtime works on both platforms.** On an iPhone 15 Pro: cold load 0.78 s and a median decision of 18 ms. On the Android emulator: 1.45–1.75 s and about 21–30 ms.
- **The shipped model failed accuracy.** English scored 5/10 and Taglish 4/10 against targets of ≥ 7 and ≥ 6.
- **A fine-tune on real PH fact-check pairs ("ft3") meets the gate,** both on the laptop and on the iPhone: **English 7/10, Taglish 6/10**, 0 option-order flips.
- **Apple's on-device model** matched that on the 20 fixtures, but its prompt was written with those fixtures in view. On 407 *unseen* fact-check pairs it scores **0.32**, against ft3's 0.77. It almost never answers "unrelated" and fails to name an option 16% of the time.
- **Recommendation and current direction: ft3 Decima is the verdict engine** on iOS and Android. Apple's model stays out of verdicts.

## Repo and branches

- Remote: `github.com/brenfreeze/claim-check` (**public**). Push as the `gh` account **brenfreeze**. Per the user, **confirm the account before every GitHub operation**: there is no saved project rule, by choice. Always ask before pushing.
- `origin/main` = `43a19fe`. Local `main` = `1f572ae`, one commit ahead and **not pushed**: the ft1/ft2 harness.
- **Current branch `feat/apple-llm-engine`**, 5 commits ahead of `main`, not pushed:
  - `f1b577d` Apple on-device LLM engine (`src/engine/LlmDecisionEngine.ts`, `modules/apple-llm`, `src/spike/llmProtocol.ts`)
  - `2828efb` iPhone Apple-LLM results
  - `07c2e38` `src/app` renamed to `src/spike`; the debug screen is now `src/spike/SpikeScreen.tsx`, and `App.tsx` re-exports it. This was done for expo-router.
  - `595bf31` ft3 harness, data scripts and docs
  - `a5d626d` ft3 on-device variant switch (`EXPO_PUBLIC_MODEL_VARIANT=ft3`), `fixtures/phase0.reference.ft3.json`, and iPhone ft3 results
- The tree is clean. `npx jest` passes 438/438 and `npx tsc --noEmit -p .` is clean.
- Merging `feat/apple-llm-engine` into `main` hasn't been asked for or done yet. Ask the user.

## Parallel session: UI (`claim-check-ui`)

Another Claude session is building the product UI from 7 mockups with expo-router, branched from `feat/apple-llm-engine` @ `07c2e38`.
- **It owns:** `app/` (routes, including `app/spike.tsx` re-exporting `src/spike/SpikeScreen`), `src/ui/`, `src/core/checkTypes.ts` (the `ClaimResult`/`CheckResult` types), and `src/core/*` **stubs**.
- **Its stub signatures:**
  - `engines.ts`: `createEngine(kind)`
  - `checkPipeline.ts`: `runCheck(input, {engine, signal}): AsyncIterable<CheckEvent>`
  - `ocr.ts`: `recognizeText`
  - `shareIntent.ts`: `useSharedText`
  - `factcheckCache.ts`: `matchCached`
  - `settings.ts`
- **Agreed handoff:** when the UI session says its branch is ready, merge it, then take over `src/core/*` (except `checkTypes.ts`) and replace the stub bodies with the real engine pipeline. Until then, **don't edit `src/core/`**. It will send the final types once the user approves the design.
- **Rules it agreed to:** keep `src/app/` nonexistent; never run `expo prebuild`; no second iOS build in a worktree (disk); ask before taking port 8081.
- Reach it with `ListAgents` / `SendMessage` (name `claim-check-ui`) if it's still alive.

## Engines (all behind `DecisionEngine`, `src/engine/types.ts`)

| Engine | Where | Status |
| --- | --- | --- |
| `OnDeviceDecimaEngine` (`id: decima-local`) | iOS + Android, onnxruntime-react-native, int8 encoder + scorer, JS XLM-R tokenizer | Production path. Load in ~0.8 s on iPhone. Takes any Decima export dir: the shipped base, or **ft3** at `models/finetune/ft3/onnx-int8/` |
| `LlmDecisionEngine` + `modules/apple-llm` (`id: apple-on-device`) | iOS 26+ with Apple Intelligence; Foundation Models with permissive guardrails, greedy sampling | Works, but **fails unseen data** (0.32 on fact-check dev). Keep out of verdicts; maybe use for FR-11 style signals |
| `http` | — | Not built (laptop / hosted fallback per the parent PRD) |

## Accuracy summary (int8; English/Taglish fixtures of 10, 20 items × 3 option orders)

| Model | Fixtures | Fact-check dev (407 unseen) | MNLI val |
| --- | --- | --- | --- |
| Decima-small (shipped) | 5 / 4 | 0.41 | 0.62 |
| ft1 (MNLI + synthetic) | 6 / 4 | — | 0.73 |
| ft2 (+ MT Tagalog MNLI) | 5 / 4 | — | 0.76 |
| **ft3 (VERA Files pairs)** | **7 / 6** | **0.77** | 0.73 |
| Apple on-device, iPhone, one-step | 7 / 6 (prompt not held out) | **0.32** (Mac) | — |

## Open issues, highest priority first

1. **VERA Files licensing.** ft3 was trained on 2,193 pairs mined from VERA Files, whose content is marked "All Rights Reserved". Rappler and AFP were skipped per `robots.txt`.
   - **Shipping ft3 needs VERA Files' permission or a retrain on licensed data.** One option is ClaimReview via Google Fact Check Tools: claims and ratings, no bodies.
   - Mined text is local and git-ignored (`harness/data/factcheck/`).
2. **Parity (SP-05) for ft3 on iOS.** The max probability delta vs Python is 0.066: the iPhone resolves ORT 1.30 while the reference uses 1.24. It's **0.024** against Python on the same ORT 1.30, on one item (en-07). All decisions are identical.
   - Fix by pinning ORT everywhere. Android resolves `onnxruntime-android` `latest.integration` (1.31) and the iOS pod `onnxruntime-c` (1.30).
   - And/or try keeping the scorer graph (5 MB) at higher precision.
3. **Weak evidence base.** 20 fixtures, labels still unreviewed (`reviewStatus: draft`). ft3's pass has no margin: two Taglish items sit near p 0.5. ft3's training labels are heuristic, with an estimated 10–20% noise. Grow and review the set (60+ items) before trusting the gate.
4. **Memory.** iPhone footprint after load is about 575 MB in a debug build (target ≤ 500 MB); the engine adds about 0.44 GB on iOS and 0.25–0.28 GB PSS on Android. Measure a release build.
5. **Android ft3 run not done yet.** The emulator is ready; see "How to run".
6. **Product pipeline (Phase 1) not built:** claim extraction (FR-04), the retrieval proxy (Next.js route, search + Google Fact Check Tools, FR-05), aggregation into Supported/Contradicted/Unverified (FR-07), and the confidence gate (FR-09). The UI session is stubbing `src/core/` for this.
7. On hold at the user's request: a laptop bake-off of **Laya-multilingual** (`convaiinnovations/laya-multilingual`, 322M, Apache-2.0, mmBERT, lists Tagalog) via Ollaya as a cross-platform engine candidate.

## Machine and environment gotchas (learned the hard way)

- **Disk is tight: about 14 GB free.** iOS build + Pods take about 6 GB. Check `df -h ~` before big steps, and keep only the best fine-tune checkpoint.
- **Never run `expo prebuild`** for iOS changes: it regenerates `ios/` and wipes Pods and build output (about 10 min to rebuild). For new native modules, run `cd ios && pod install`, then rebuild.
- **iOS 27** kills apps without the UIScene lifecycle. `plugins/with-scene-lifecycle.js` (in `app.json`) handles it; keep it.
- **iPhone (free Apple ID):** team `RK25HYS4GC` (in `app.json` as `ios.appleTeamId`), bundle `com.claimcheck.app`, device UDID `00008130-001148EC0C38001C`.
  - **Signing expires after 7 days**, so re-install before demos.
  - Launches fail if the phone is locked.
  - Build: `cd ios && xcodebuild -workspace claimcheck.xcworkspace -scheme claimcheck -configuration Debug -destination 'id=00008130-001148EC0C38001C' -derivedDataPath build -allowProvisioningUpdates build`
  - Install: `xcrun devicectl device install app --device <UDID> ios/build/Build/Products/Debug-iphoneos/claimcheck.app`
  - Launch: `xcrun devicectl device process launch --terminate-existing --device <UDID> --payload-url "exp+claim-check://expo-development-client/?url=http%3A%2F%2F<MAC_IP>%3A8081" com.claimcheck.app`
  - Mac LAN IP was `192.168.100.160`.
- **Android emulator:** AVD `Medium_Phone_API_37.0`; start it headless with `-no-window`.
  - **Never kill adb** or non-LISTEN holders of port 8081. Killing adb crashes the emulator; use `lsof -t -iTCP:8081 -sTCP:LISTEN`.
  - Protocol: `scripts/run-device-protocol.sh 1 2 4`, then `python3 scripts/summarize-device.py`. It doesn't pass `EXPO_PUBLIC_MODEL_VARIANT` yet; add that for ft3.
- **Patches:**
  - `patches/onnxruntime-react-native+1.24.3.patch` fixes Gradle 9.
  - `patches/@huggingface+tokenizers+0.2.0.patch` builds the tokenizer without the trie, saving about 2 s of cold load.
  - `react-native.config.js` fixes ORT autolinking on Android.
  - Package versions are pinned exactly; `npm install` re-applies the patches.
- **Python harness:** `cd harness && uv run …`. Key scripts:
  - `export_reference.py --model <dir> --out <json>`
  - `finetune.py`, `eval_finetune.py`
  - `mine_factcheck.py`, `build_factcheck_pairs.py`, `translate_mnli.py`
- Hit by Anthropic API rate limits mid-agent twice; resuming the agent with `SendMessage` worked.

## Services that were running at handoff (may be gone in a new session)

- Metro on :8081 with `EXPO_PUBLIC_AUTORUN=1 EXPO_PUBLIC_ENGINE=decima EXPO_PUBLIC_MODEL_VARIANT=ft3 EXPO_PUBLIC_THREADS=2 EXPO_PUBLIC_MODEL_URL=http://192.168.100.160:8766`
- Base model server on :8765: `python3 -m http.server 8765 --bind 0.0.0.0 --directory models/decima-small/onnx/int8`
- ft3 model server on :8766: same, with `--directory models/finetune/ft3/onnx-int8`
- Android emulator `emulator-5554`, headless

## Suggested next steps (ask the user which)

1. Android emulator run of ft3: needs the variant env in Metro and a 10.0.2.2 or LAN model URL. About 2 minutes.
2. Parity fix: pin ORT versions, and/or a higher-precision scorer; re-check en-07 against ≤ 0.02.
3. Draft the permission request to VERA Files, and/or scope a licensed-data retrain.
4. Grow and review the fixture set.
5. Once the UI branch lands, implement `src/core/` (engines + check pipeline) on ft3.
