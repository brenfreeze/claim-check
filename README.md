# CheckitFirst (claim-check)

An on-device fact-checker for Philippine social-media posts. You paste text, share it, or scan a screenshot. The app finds the checkable claims and asks one question per claim: **"Has this already been fact-checked?"** It answers on the phone, with no network, by matching each claim against a bundled corpus of PH fact-checks with a small on-device model (Decima-small, fine-tuned as "ft3"). When the phone is online, an optional "Online enrichment" step can look for newer fact-checks.

Expo (dev build) + expo-router + TypeScript, with ONNX Runtime for the model and a Python harness for training and evaluation.

> Status: hackathon build. The offline-first pipeline is in progress; see `docs/superpowers/plans/2026-10-10-offline-first.md`. Read `docs/HANDOFF.md` for the full project state, decisions and gotchas.

## Repo map

| Path | What |
| --- | --- |
| `app/` | expo-router routes: Home, Scan, Analyzing (`check/[id]`), Results, Claim detail, Settings, `/spike` |
| `src/ui/` | Components, tokens and the check store/reducer |
| `src/core/` | The app's pipeline surface: `checkPipeline`, `engines`, `connectivity`, `factcheckCache`, `settings`. `checkTypes.ts` is the UI contract |
| `src/pipeline/` | Offline matcher and corpus loading |
| `src/engine/` | `DecisionEngine` implementations: on-device Decima (ONNX) and Apple on-device LLM |
| `src/spike/` | Phase 0 debug screen, including the model download to the phone |
| `modules/apple-llm/` | Local Expo module for Apple Foundation Models (iOS 26+) |
| `assets/corpus/` | Bundled fact-check corpus (`debunks.json`, `meta.json`, `demo-overrides.json`) |
| `scripts/` | Corpus pull, device protocol and tokenizer parity scripts |
| `harness/` | Python (uv): reference export, fine-tuning, evaluation |
| `fixtures/` | Phase 0 fixtures and the Python reference outputs used by Jest |
| `plugins/` | Config plugins. `with-scene-lifecycle.js` is **required**, because iOS 27 kills apps without UIScene |
| `patches/` | patch-package fixes, applied on `npm install` |

## Prerequisites

- **macOS** with **Xcode** for iOS. The project was built on Xcode 27 / iOS 27.
- **Node 22+**. The scripts use `node --experimental-strip-types`, which needs 22.6 or later.
- **CocoaPods** (`brew install cocoapods`).
- **Android Studio** plus an emulator, if you want Android.
- **uv** (`brew install uv`), for the Python harness only.
- About **15 GB free disk** for iOS: Pods + build take about 6 GB, and the models a few hundred MB.

## 1. Clone and install

```bash
git clone https://github.com/brenfreeze/claim-check.git
cd claim-check
npm install          # also applies patches/ (onnxruntime-react-native Gradle fix, trie-free tokenizer)
```

Versions are pinned exactly on purpose, because the patches are version-locked. Don't bump `onnxruntime-react-native` or `@huggingface/tokenizers` without regenerating the patches.

## 2. Secrets (`.env.local`)

Create `.env.local` in the repo root. It's git-ignored. **The repo is public, so never commit keys.**

```bash
FACTCHECK_API_KEY=AIza...            # Google Fact Check Tools API key; build-time corpus pull
EXPO_PUBLIC_FACTCHECK_API_KEY=AIza... # same key; optional Online enrichment in the app (inlined into the dev bundle)
```

To get a key: Google Cloud Console → enable **Fact Check Tools API** → *Credentials → Create credentials → API key*. Restrict it to the Fact Check Tools API, with no application restriction. You need an API key, not an OAuth client ID.

You don't need a key to run the app offline. The corpus is committed.

## 3. Models (not in git)

`models/` is git-ignored. The app downloads its model files to the phone once, from a laptop HTTP server (see step 5).

- **Base Decima-small** (public):
  ```bash
  uvx --from 'huggingface_hub[cli]' hf download amyrmahdy/decima-small --include 'onnx/int8/*' --local-dir models/decima-small
  ```
- **ft3 fine-tune** (`models/finetune/ft3/onnx-int8/`): the verdict model the app uses. **It isn't distributed.** It was trained on VERA Files content that is not licensed for redistribution (see `docs/HANDOFF.md`, open issue 1). Get a copy privately from the maintainer, or retrain with `harness/` on data you're licensed to use.

## 4. Tests

```bash
npx jest                  # unit + engine parity tests (engine tests skip if models/ is missing)
npx tsc --noEmit -p .
```

## 5. Run on an iPhone

`ios/` and `android/` are git-ignored, so on a **fresh clone** generate them once:

```bash
npx expo prebuild --platform ios
```

> After that first prebuild, **don't run `expo prebuild` again** on a machine that already has `ios/`. It regenerates the folder and wipes Pods and build output, about 10 minutes to rebuild. When you add a native module, run `cd ios && pod install` and rebuild instead. Put any Info.plist changes in `app.json` too, so a future prebuild keeps them.

Signing:
- In `app.json`, change `ios.appleTeamId` to **your** team ID (a free Apple ID works) and, if needed, `ios.bundleIdentifier`.
- Free-account builds expire after **7 days**, so re-install before a demo.
- Launching fails while the phone is locked.

Build and install (replace `<UDID>`; `xcrun devicectl list devices` shows it):

```bash
cd ios && pod install && cd ..
cd ios && xcodebuild -workspace claimcheck.xcworkspace -scheme claimcheck -configuration Debug \
  -destination 'id=<UDID>' -derivedDataPath build -allowProvisioningUpdates build && cd ..
xcrun devicectl device install app --device <UDID> ios/build/Build/Products/Debug-iphoneos/claimcheck.app
```

Start Metro and serve the model to the phone over your LAN:

```bash
EXPO_PUBLIC_MODEL_VARIANT=ft3 EXPO_PUBLIC_MODEL_URL=http://<MAC_LAN_IP>:8766 npx expo start --dev-client
python3 -m http.server 8766 --bind 0.0.0.0 --directory models/finetune/ft3/onnx-int8
```

Open the app, go to **Settings → Developer → Phase 0 spike**, and download the model. It's stored on the phone and survives restarts. After that, checks run without the model server.

Launch from the terminal:

```bash
xcrun devicectl device process launch --terminate-existing --device <UDID> \
  --payload-url "exp+claim-check://expo-development-client/?url=http%3A%2F%2F<MAC_LAN_IP>%3A8081" com.claimcheck.app
```

Deep link that pre-fills Home: `claimcheck://?text=<url-encoded post>`.

## 6. Run on Android (emulator)

```bash
npx expo prebuild --platform android      # fresh clone only
npx expo run:android
```

The emulator reaches the laptop at `10.0.2.2`, so use `EXPO_PUBLIC_MODEL_URL=http://10.0.2.2:8766`.

**Never kill `adb`**, and never kill processes holding port 8081 other than Metro's listener, or the emulator crashes. To stop Metro: `lsof -t -iTCP:8081 -sTCP:LISTEN | xargs kill`.

## 7. Rebuild the fact-check corpus (optional, online)

```bash
node --experimental-strip-types scripts/pull-factchecks.ts
```

It pulls ClaimReview data (claims and ratings, no article bodies) for PH topics × PH publishers from Google Fact Check Tools. It writes `assets/corpus/debunks.json` and `meta.json`. Add Taglish aliases for demo items by hand in `assets/corpus/demo-overrides.json`.

## 8. Python harness (optional)

```bash
cd harness
uv sync                                  # inference deps
uv sync --group train                    # + training deps (torch etc.)
uv run python export_reference.py        # Python reference → fixtures/phase0.reference.json
```

See `docs/phase0-results.md` and `docs/phase0-finetune.md`.

## Env vars

| Var | Where | Purpose |
| --- | --- | --- |
| `FACTCHECK_API_KEY` | `.env.local` | Corpus pull script |
| `EXPO_PUBLIC_FACTCHECK_API_KEY` | `.env.local` | In-app Online enrichment (optional) |
| `EXPO_PUBLIC_MODEL_VARIANT` | Metro | `ft3` selects the fine-tune; anything else selects base Decima-small |
| `EXPO_PUBLIC_MODEL_URL` | Metro | Laptop URL the phone downloads the model from |
| `EXPO_PUBLIC_THREADS` | Metro | ORT intra-op threads (2 is a good default) |
| `EXPO_PUBLIC_ENGINE` | Metro | Spike engine (`decima` / Apple) |
| `EXPO_PUBLIC_AUTORUN` | Metro | `1` opens the Phase 0 spike and runs the protocol on launch |

## Docs

- `docs/HANDOFF.md`: current state, engines, open issues, machine gotchas
- `docs/phase0-results.md`, `docs/phase0-finetune.md`: Phase 0 measurements and the ft3 fine-tune
- `docs/superpowers/plans/`: implementation plans
- `DEMO.md`: demo script and airplane-mode checklist (once added)
