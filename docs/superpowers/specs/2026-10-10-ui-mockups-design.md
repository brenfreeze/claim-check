# Claim-Check Mobile UI from the mockups: design

Date: 2026-10-10 · Branch: `feat/ui-mockups` (from `feat/apple-llm-engine` @ 595bf31) · Worktree: `/Users/bren/claim-check-ui`

## Product pivot (amendment, 2026-10-10)

The core question becomes **"Has this already been fact-checked?"**, answered entirely on-device:
1. Extract the claims.
2. Match them against a bundled corpus of PH fact-checks (Decima ft3 same/different).
3. Show the results.

The default path never touches the network. Live search becomes an optional per-claim **Online enrichment** step. The engine session owns the corpus (`assets/corpus/`) and the matcher (`src/pipeline/matchOffline.ts`), and wires them into `src/core` after this branch merges. Effects on the UI:

- Every result shows "Checked on-device against N saved fact-checks · synced <date>" (from `corpusInfo()`), on Results and as the Home chip.
- A matched claim's main evidence card *is* the fact-check: publisher, date, rating pill (false / misleading / true), summary, and URL.
- An Unverified claim reached by the offline path shows "No known fact-check" and an **Online enrichment** button. The button is enabled only when `useIsOnline()` is true; offline, it queues the claim and shows "Queued for recheck". Enrichment streams live-search results into the same claim.
- The Analyzing stepper becomes Find claims → Match saved fact-checks → Calibrate verdicts. Its subtitle reads "Everything runs on this phone. Nothing is sent." Enrichment shows its own Find evidence → Weigh evidence progress on the claim.
- The mockup's "You're offline" banner appears only when `useIsOnline()` is false. The Offline mockup's matched-block and queued styles become the standard claim-card variants.
- `@react-native-community/netinfo` is added by the engine session, not here; `src/core/connectivity.ts` is a stub hook.
- No restyling, route renames, or new screens.

## Goal

Build the seven mockup screens from `claim-check-mockups.zip` (Home, Scan screenshot, Analyzing, Results, Claim detail, Offline results, Settings) as an expo-router app, adjusted by the pivot above. The UI runs against mock implementations of the `src/core/` API while the engine session (`claim-check-main`) builds the real pipeline in parallel. The Phase 0 spike screen stays, moved to its own route.

Source of truth for visuals: the mockup HTML (`mockups/*.dc.html`) and `HANDOFF.md` in the zip (tokens, components, interaction notes).

## Ownership and coordination

| Path | Owner |
|---|---|
| `app/`, `src/ui/` | UI session |
| `src/core/checkTypes.ts` | UI session (permanently) |
| `src/core/*` (other files) | UI session until the branch is handed off, then the engine session replaces the mock bodies |
| `src/engine/`, `src/spike/`, `modules/`, `harness/`, `models/`, `plugins/`, `results/`, `docs/phase0-*` | Engine session; the UI does not edit them |
| `package.json`, `app.json` | UI session may edit; existing plugins (`expo-dev-client`, `onnxruntime-react-native`, `./plugins/with-scene-lifecycle`), `ios.appleTeamId`, and the patched pins (`@huggingface/tokenizers 0.2.0`, `onnxruntime-react-native 1.24.3`) must stay |

Rules:
- `src/app/` must not exist; expo-router would take it as its root.
- No `expo prebuild`: it regenerates `ios/` and wipes Pods.
- No native build in the worktree: about 11 GB free disk.
- Metro port 8081 belongs to the engine session; the UI web preview uses 8082.
- No push, PR, or merge without asking the user.

## Architecture

```
app/                         expo-router; package.json main → "expo-router/entry"; App.tsx and index.ts deleted
  _layout.tsx                load fonts (splash held until ready), Stack with headerShown:false, SafeAreaProvider
  index.tsx                  Home
  scan.tsx                   Scan screenshot: OCR sentence picker
  check/[id].tsx             Analyzing: starts runCheck, writes the check store
  results/[id].tsx           Results (offline banner when useIsOnline() is false; matched and queued card variants from the Offline mockup)
  claim/[id].tsx             Claim detail; id = "<checkId>:<claimIndex>", ‹ › move between claims
  settings.tsx               Settings, with a "Phase 0 spike" row linking to /spike
  spike.tsx                  export { default } from '../src/spike/SpikeScreen'
  spike.web.tsx              placeholder: ONNX and the native modules do not run on web
src/ui/
  tokens.ts                  colors, fonts, radii, spacing (HANDOFF.md tokens verbatim) + type scale
  icons.tsx                  mockup SVG icons via react-native-svg (chip, settings, camera, clipboard, share, check, x, question, chevrons, back, wifi-off, lock)
  components/                VerdictChip, ClaimCard, ConfidenceBar, EvidenceCard, PipelineStepper, EngineBadge,
                             SignalsPanel, OfflineBanner, EngineOption, SectionLabel, Button, ScreenHeader
  checkStore.ts              in-memory store of checks by id + recent list; useSyncExternalStore; pure reducer
  format.ts                  pure view helpers
src/core/
  checkTypes.ts              shared contract (below)
  engines.ts                 engineOptions(), createEngine(choice, cfg)
  checkPipeline.ts           runCheck(input, opts): AsyncIterable<CheckEvent>
  settings.ts                useSettings(), setSettings()
  checkPipeline.ts (also)    enrichClaim(check, claimId, opts): AsyncIterable<CheckEvent>
  ocr.ts                     recognizeText(uri)
  shareIntent.ts             useSharedText()
  factcheckCache.ts          matchCached(claim), corpusInfo(): { count, syncedAt }
  connectivity.ts            useIsOnline(): boolean (stub; netinfo-backed later)
```

### State flow

1. Home ("Check claims") or Scan ("Check N claims") calls `checkStore.start({ input, source })`. That returns a new id and navigates to `/check/<id>`.
2. Analyzing starts `runCheck(input, { engine, gate, source, signal })` once per id and passes each `CheckEvent` to the store reducer. The stepper and the "So far" list read from the store.
3. On `done`, Analyzing replaces itself with `/results/<id>`. "See results so far" goes to Results early; the stream keeps running, and Results shows pending claims as "Still checking…" rows.
4. Results and Claim detail read the store by id. Home's "Recent checks" reads `checkStore.recent()`. History is in memory only; persisting it is out of scope.

Engine selection: `createEngine(settings.engine, { lanUrl })` is called when a check starts, so changing the engine in Settings applies to the next check without a restart.

## Data contract (`src/core/checkTypes.ts`)

```ts
export type Verdict = 'supported' | 'contradicted' | 'unverified';
export type EngineChoice = 'decima-local' | 'apple-on-device' | 'lan' | 'hosted';
export type Stance = 'supports' | 'contradicts' | 'unrelated';
export type CheckSource = 'paste' | 'share' | 'screenshot';

export type FactcheckRating = 'false' | 'misleading' | 'true';
export type ClaimPath = 'offline-match' | 'live-search';

export interface EvidenceSource {
  url: string; publisher: string; domain: string; title: string;
  tier: 'A' | 'B' | 'C';
  kind: 'government' | 'factcheck' | 'news' | 'other';
  snippet: string;                       // best chunk (live) or fact-check summary (offline); shown highlighted
  stance: Stance; confidence: number;    // offline match: confidence = p(same claim)
  date?: string;                         // ISO; shown on fact-check cards
  claimReview?: { rating: string; headline: string };   // rating pill; offline corpus uses FactcheckRating
}

export interface ClaimResult {
  id: string;
  text: string;                          // normalized English
  original: string;                      // sentence from the post
  path: ClaimPath;                       // how this verdict was reached
  verdict: Verdict; confidence: number;  // confidence < gate ⇒ verdict 'unverified'
  reason: string;                        // offline no-match: "No known fact-check"
  evidence: EvidenceSource[];            // strongest first; offline match = the fact-check itself (tier A, kind factcheck)
  stats: { engine: EngineChoice; decisions: number; ms: number; rule: string; calibration: string };
  enrichment?: { status: 'idle' | 'queued' | 'running' | 'done' | 'failed'; message?: string };
}

export interface CheckResult {
  id: string; input: string; source: CheckSource; createdAt: string;   // ISO
  sentenceCount: number; gate: number;
  corpus: { count: number; syncedAt: string };   // "Checked on-device against N saved fact-checks · synced <date>"
  networkUsed: boolean;                  // false on the default path ("0 bytes sent")
  claims: ClaimResult[];
  signals: string[];                     // post-level writing signals, never part of a verdict
  stats: { engine: EngineChoice; decisions: number; totalMs: number; modelLoadMs?: number };
}

export type Stage = 'extract' | 'match' | 'aggregate' | 'retrieve' | 'judge';   // retrieve/judge only during enrichment
export type CheckEvent =
  | { type: 'stage'; stage: Stage; status: 'active' | 'done'; summary?: string; meta?: string }
  | { type: 'progress'; stage: 'judge'; done: number; total: number; avgMs: number }
  | { type: 'pending'; claims: { id: string; text: string; sources: number }[] }
  | { type: 'claim'; claim: ClaimResult }          // also used to replace a claim after enrichment
  | { type: 'done'; result: CheckResult }
  | { type: 'error'; message: string };

export interface EngineOption {
  id: EngineChoice; name: string; desc: string; latency: string;
  badge: string;                         // EngineBadge text, e.g. "On-device · 21 ms"
  privacy: string;                       // privacy note under Settings
  available: boolean; unavailableReason?: string;
}

export interface Settings {
  engine: EngineChoice; lanUrl: string; gate: number;   // gate default 0.70, range 0.50–0.95, step 0.05
  compareHosted: boolean;
  factcheckSources: Record<'verafiles' | 'rappler' | 'tsek', boolean>;
  wifiOnlySync: boolean;
}

export interface OcrResult { sentences: { text: string; claimScore: number }[]; ms: number }
```

Deliberate changes from the engine session's draft:
- `createEngine` takes an `EngineChoice`, because LAN and hosted are both `DecisionEngine.id === 'http'`.
- `recognizeText` returns `OcrResult` instead of a string, because the Scan screen shows a claim score per sentence.

### Engine options

| id | name | desc | badge | privacy | available |
|---|---|---|---|---|---|
| decima-local | On this phone | Decima-small · works offline · nothing leaves the device | On-device · 21 ms | Only the claim text is sent to find sources. Every judgment runs on this phone. | always |
| apple-on-device | On this phone · Apple Intelligence | Apple on-device model · iOS 26+ · nothing leaves the device | Apple · on-device · ~0.9 s | same as Decima | iOS with Apple Intelligence ready; else disabled, "Needs iOS 26 + Apple Intelligence" |
| lan | Laptop on local Wi-Fi | Decima serve at {lanUrl} · still local AI | Laptop · 38 ms | Claims and evidence go to your laptop on this network. Nothing reaches a cloud AI. | always |
| hosted | Hosted Jev | Accuracy reference · needs internet | Hosted · 410 ms | Claims and evidence are sent to the hosted Jev API for judging. | always |

If the saved engine becomes unavailable, Settings shows a note and checks use `decima-local`.

## Screens (behavior beyond the mockup visuals)

- **Home:**
  - Text box (initialised from `useSharedText()`); "N sentences" counter; "Taglish detected" from a simple keyword heuristic in `format.ts`.
  - "Check claims" is disabled when the box is empty.
  - "Paste" uses expo-clipboard. "Scan screenshot" goes to `/scan`.
  - Engine badge and "Fact-checks synced …" chip; recent checks (latest 5).
- **Scan:**
  - Opens the image picker (expo-image-picker) on entry; on web or with the mock, uses the example screenshot.
  - Shows the image, then `recognizeText` sentences with checkboxes. Sentences scoring below 0.5 start unchecked and are labelled "not a checkable claim".
  - The CTA reads "Check N claims" for the N checked sentences and is disabled at 0.
- **Analyzing:**
  - "Cancel" aborts the check and returns Home.
  - Stepper: done / active (progress bar and decision count) / pending. "So far" list.
  - "See results so far". On `error`: message, Retry, and Back.
- **Results:**
  - Totals (contradicted, supported, unverified), the "Checked on-device against N saved fact-checks · synced …" line, and the engine/decisions/time line.
  - Claim cards: a matched claim shows the saved fact-check block. An Unverified claim has a dashed border, "No known fact-check", and the Online enrichment button or "Queued for recheck".
  - Signals panel and the no-"fake"-score footer.
  - "You're offline" banner when `useIsOnline()` is false; "0 bytes sent" line when `networkUsed` is false.
  - The share button opens the system share sheet with a plain-text summary.
- **Claim detail:**
  - Claim N of M with ‹ › (disabled at the ends), verdict card with a confidence bar and gate marker, and the reason.
  - Evidence cards: Tier A filled, Tier B outlined, ClaimReview pill, highlighted snippet. Unrelated sources are muted and marked "Unrelated · ignored". "Open source" uses `Linking.openURL`.
  - "How this was decided" table.
  - "Share verdict" uses the share sheet. "Report wrong verdict" shows a "Thanks — noted" toast; it is a stub.
- **Settings:**
  - Engine radio (4 options above) and compare toggle.
  - Model card: the mock shows decima-small int8 140 MB Downloaded. "Re-download" is a stub.
  - Gate slider (@react-native-community/slider). Offline fact-checks block with "Sync now" (stub) and source toggles. Privacy note follows the selected engine.
  - "Developer · Phase 0 spike" row links to `/spike`.
  - The Apple option is labelled experimental. Held-out evaluation has it at 0.32 on unseen fact-check pairs, so ft3 Decima stays the default.

## Error handling

- A `CheckEvent` `error` shows an error state on Analyzing that keeps any finished claims, with Retry (new run) and Back.
- An unknown id on `/check`, `/results`, or `/claim` shows "Check not found" with a Home link.
- An unavailable engine option is disabled with its reason. A saved engine that has become unavailable falls back to Decima, with a note.
- Fonts load before the first render (splash held), so there is no flash of system font.

## Dependencies (via `npx expo install`, SDK 57 versions)

expo-router, react-native-screens, react-native-safe-area-context, expo-linking, expo-constants, expo-splash-screen, expo-font, react-native-svg, @react-native-community/slider, expo-clipboard, expo-image-picker, @expo-google-fonts/source-serif-4, @expo-google-fonts/ibm-plex-sans, @expo-google-fonts/ibm-plex-mono, react-native-web, react-dom, @expo/metro-runtime.

app.json: add the `expo-router` plugin and `"scheme": "claimcheck"`, and keep the existing plugins and fields.

## Testing

- **Jest (existing Node/ts-jest config, `src/**/*.test.ts`):**
  - `src/ui/__tests__/format.test.ts`: totals, gate label, source summary ("PAGASA · Vera Files · +1"), relative time, sentence count, Taglish heuristic.
  - `src/ui/__tests__/checkStore.test.ts`: the reducer over a recorded event sequence, including cancel and error.
  - `src/core/__tests__/checkPipeline.test.ts`: the mock emits events in a valid order (stage(active) before stage(done), claims before done, done last) and stops on abort.
- `npx tsc --noEmit` passes.
- **Visual check:**
  - `npx expo start --web --port 8082` in Chrome at a width of 390 px.
  - Screenshot each screen beside its mockup, and fix spacing and type differences before marking the screen done.
  - The mockups' gaps are flex gaps, so they map to RN `gap`.
- **Final device check:**
  - Merge into the main checkout, then `pod install` and an iOS build on the iPhone.
  - Timing is arranged with the engine session, which owns 8081 and the build directory.

## Out of scope

- Real OCR, share intent, retrieval, judging pipeline, and offline cache (engine session).
- Persisting check history across restarts.
- What "Report wrong verdict", "Re-download", and "Sync now" actually do (stubs).
- Dark mode (the app is light-only).
- The iOS share extension (needs the paid Developer Program).

## Handoff

1. After spec approval, send `checkTypes.ts` to the engine session.
2. When the branch is complete and verified, tell the engine session it's ready. It merges `feat/ui-mockups` and takes over `src/core/*` except `checkTypes.ts`.
