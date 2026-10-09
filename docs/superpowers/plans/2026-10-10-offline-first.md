# Offline-first fact-check matching: implementation plan

**Goal:** CheckitFirst answers "Has this already been fact-checked?" fully on-device, against a bundled corpus of PH fact-checks. Live search becomes an optional "Online enrichment".

**Spec:** this plan's "Spec" section. It is the user's pivot brief, pasted in the session on 2026-10-10. Where the brief and the repo disagree, the rulings below settle it.

**Branch:** `feat/apple-llm-engine` (main checkout, `/Users/bren/claim-check`), with `feat/ui-mockups` merged at `25d8cfa`.

## Spec (from the user's brief, condensed; binding)

1. **Corpus pull script, `scripts/pull-factchecks.ts`.** It runs once, online, at build time.
   - It calls Google Fact Check Tools `GET https://factchecktools.googleapis.com/v1alpha1/claims:search` with `query`, `languageCode`, `reviewPublisherSiteFilter`, `pageSize`, `pageToken`, and `key` from `FACTCHECK_API_KEY`.
   - It loops a configurable list of PH topic queries × a configurable list of PH publisher sites, and logs the count each combination returns.
   - It normalizes `textualRating` to `'false' | 'misleading' | 'true' | 'other'` with a keyword map, logs unmapped ratings, and drops `other`.
   - It dedupes by review URL and writes `assets/corpus/debunks.json`.
   - It creates `assets/corpus/demo-overrides.json`, hand-edited and merged on top, seeded with 3 placeholder entries.
   - It prints the total, the count per publisher, and the count per rating.
2. **Offline matcher, `src/pipeline/matchOffline.ts`.**
   - Load and merge the corpus, and precompute character-trigram sets for each claim and each alias.
   - Prefilter with trigram Jaccard, take the top k=8, then make one Decima decision per candidate.
   - Above the gate (the gate setting, default 0.7): rating `true` → `supported`; `false`/`misleading` → `contradicted`; attach the Debunk.
   - Otherwise → `unverified`, with reason "No known fact-check".
   - Jest tests use a fake DecisionEngine and cover: exact match, alias match, below gate → unverified, and `true` → supported.
3. **Wire into the app.**
   - Order: extraction → matchOffline (always; no network needed) → results.
   - A match becomes a fact-check evidence card: tier A, kind `factcheck`, plus `path`.
   - An unverified offline claim shows "No known fact-check" and an Online enrichment button. The button is enabled only when NetInfo reports internet; otherwise it shows "Queued for recheck".
   - The default path never calls the network. A dev guard logs any fetch made during an offline check.
   - Copy: "Checked on-device against N saved fact-checks · synced <date>".
4. **Demo readiness.**
   - `DEMO.md`: 3 inputs (a recycled hoax, a true claim, a novel claim), the expected verdicts, and an airplane-mode checklist.
   - A device run in airplane mode, with latency measured per claim.

**Do NOT:**
- add embeddings, a vector DB, background sync or SQLite;
- refit calibration or change the Decima integration (`src/engine/*`);
- restyle screens or rename components/routes;
- add screens.

## Global Constraints (copy verbatim into every dispatch)

- TypeScript strict. Match the surrounding code's style: comment density, naming, 2-space indent, single quotes, line width ~120.
- Do not edit `src/engine/*`, `src/ui/*`, `app/*` or `src/core/checkTypes.ts`, unless a task explicitly says so.
- `npx jest` and `npx tsc --noEmit -p .` must pass at the end of every task. The baseline is 438 + 17 tests passing.
- Never run `expo prebuild`. Never kill `adb`. Never commit secrets: `.env.local` holds `FACTCHECK_API_KEY` and is git-ignored. The repo is public.
- Commit messages are conventional (`feat(pipeline): …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.
- The verdict framing is ft3's trained 3-way question (see the ruling below):
  - state `Claim: <post claim>\nEvidence: <fact-checked claim>`
  - question `{ kind: 'choice', instructions: 'Does the evidence support the claim?', criteria: { supports: '', contradicts: '', unrelated: '' } }`
- The `Debunk` type, exactly:
  ```ts
  export type Debunk = {
    id: string; claim: string; aliases?: string[];
    rating: 'false' | 'misleading' | 'true';
    publisher: string; date: string; url: string; summary: string; lang?: string;
  };
  ```

## Rulings made at planning time

- **R1, framing.** Use ft3's 3-way supports/contradicts/unrelated question with the fact-checked claim as the evidence, instead of the brief's new same/different question. ft3 was never trained on same/different; base Decima scored 3–4/10 on relevance framings, while ft3 scores 0.77 on 407 unseen fact-check pairs. Cost if wrong: claim-vs-claim matching is less accurate than hoped. Task 3 measures it.
- **R2, decision rule.**
  - Match when p(supports) ≥ gate. Rating `true` → `supported`; `false`/`misleading` → `contradicted`.
  - If argmax is `contradicts` with p ≥ gate, the post asserts the opposite of the checked claim. Return `unverified` with reason "Related fact-check found (post says the opposite)" and keep the Debunk as evidence. Do not invert the rating.
  - Otherwise return `unverified`, "No known fact-check".
  - Cost if wrong: true-but-opposite posts show as unverified, which is the safe failure.
- **R3, corpus build date.** It lives in `assets/corpus/meta.json` (`{ builtAt, count, perPublisher, perRating }`). `debunks.json` stays a plain `Debunk[]`. Cost: one more file.
- **R4, script runtime.** Run the script with `node --experimental-strip-types` (Node 22.17). No new dev dependency. Relative imports in scripts use `.ts` extensions. Cost: none.
- **R5, claim extraction.** Keep the existing heuristic (`splitSentences` + `mockClaimScore` in `src/core/text.ts`). A Decima Noul "is this checkable?" question is untested on ft3 and out of scope. The Scan screen already lets the user pick sentences. Cost: weaker claim detection on odd posts.
- **R6, Online enrichment.** No live-search pipeline exists in the repo, so `judgeClaim` and the retrieval proxy were never built. Enrichment instead:
  1. queries Google Fact Check Tools live for the claim text, using `EXPO_PUBLIC_FACTCHECK_API_KEY` (an Expo public env var, inlined into the dev bundle and not committed);
  2. turns the results into Debunks with the same normalizer;
  3. runs the same matcher on them;
  4. returns path `live-search`.
  With no key, it ends with `enrichment.status: 'failed'` and message "Online enrichment needs an API key". Cost: the key ships inside the dev build. It is restricted to the Fact Check API only.
- **R7, engines.**
  - `createEngine('decima-local')` loads `OnDeviceDecimaEngine` from the on-device model dir already used by the spike (`src/spike/modelStore.ts`, ft3 variant). If the files are missing, it throws "Model not on device — open Settings → Developer → Phase 0 spike to download".
  - `apple-on-device` uses `LlmDecisionEngine` with the Apple backend if the spike already constructs one. Otherwise it stays as is.
  - `lan`/`hosted` stay mocked: the HTTP engine was never built.
  - Cost: only on-device Decima is real.

## File map

| File | Task |
| --- | --- |
| `scripts/pull-factchecks.ts`, `scripts/factcheck-normalize.ts` | 1 |
| `assets/corpus/debunks.json`, `demo-overrides.json`, `meta.json` | 1 |
| `src/pipeline/corpus.ts` (`Debunk` type, `loadCorpus`, `normalizeRating` re-export), `src/pipeline/matchOffline.ts`, `src/pipeline/__tests__/matchOffline.test.ts` | 2 |
| `scripts/eval-match.ts`, `fixtures/match-eval.json`, `docs/match-eval.md` | 3 |
| `src/core/checkPipeline.ts`, `src/core/factcheckCache.ts`, `src/core/netGuard.ts`, `src/core/enrich.ts` | 4 |
| `src/core/engines.ts`, `src/core/connectivity.ts`, `package.json`, `ios/` (pod install, Info.plist key) | 5 |
| `DEMO.md` | 6 |

---

### Task 1: Corpus pull script and the bundled corpus

**Goal:** a bundled `assets/corpus/debunks.json` of real PH fact-checks, built by a re-runnable script.

**Steps:**
1. Write `scripts/factcheck-normalize.ts`, which exports:
   - `normalizeRating(textualRating: string): 'false' | 'misleading' | 'true' | 'other'`. Case-insensitive keyword map covering English and Filipino:
     - false: `false`, `fake`, `mali`, `hindi totoo`, `walang batayan`, `fabricated`, `hoax`, `scam`, `pants on fire`, `incorrect`, `not true`, `no basis`
     - misleading: `misleading`, `nakaliligaw`, `nakalilinlang`, `missing context`, `needs context`, `kulang sa konteksto`, `out of context`, `half true`, `partly false`, `mixed`, `exaggerated`, `distorted`, `inaccurate`, `satire`
     - true: `true`, `totoo`, `accurate`, `correct`, `fact`
     - anything else → `other`
     Check false/misleading keywords before true, so "not true" and "half true" don't map to true.
   - `toDebunk(claim, review)`: maps one API `claims[]` item plus its `claimReview[]` entry to a `Debunk` (or `null` when the rating is `other`).
     - `id` = a short stable hash of the review URL
     - `claim` = `claim.text`
     - `publisher` = `review.publisher.name ?? site`
     - `date` = `review.reviewDate ?? claim.claimDate`, as ISO date
     - `url` = `review.url`
     - `summary` = `review.title ?? review.textualRating`
     - `lang` = `review.languageCode`
   Script and app both import this file. Keep it free of Node APIs.
2. Write `scripts/pull-factchecks.ts`. Config arrays sit at the top of the file:
   - `QUERIES`: `class suspension`, `walang pasok`, `suspendido ang klase`, `ayuda`, `PAGASA`, `signal no`, `bagyo`, `typhoon`, `evacuation`, `DOH`, `SSS`, `GSIS`, `4Ps`, `Comelec`, `Marcos`, `Duterte`, `vaccine`, `bakuna`, `West Philippine Sea`, `ROTC`, `PhilHealth`, `DepEd`, `CHED`, `MMDA`, `LTO`, `Meralco`, `price rollback`, `sweldo`, `holiday`.
   - `PUBLISHERS`: `verafiles.org`, `rappler.com`, `tsek.ph`, `news.abs-cbn.com`, `factsfirst.ph`, `pna.gov.ph`, `factcheck.afp.com`, `newsinfo.inquirer.net`.
   - `LANGS`: `['en', 'tl']`. Per query × publisher, call once without `languageCode`; add a call per `LANGS` value only if that adds results. Keep the pass cheap.
   - Read the key from `.env.local` (parse `FACTCHECK_API_KEY=…` lines) or from `process.env`, and fail clearly when it's missing.
   - `pageSize=100`. Follow `nextPageToken` up to 5 pages. Sleep ~150 ms between requests. On 429/5xx, retry once after 2 s.
   - Log one line per query × publisher: `<query> × <site>: <n>`. Log every unmapped rating with its count.
   - Dedupe by review URL. Sort by date, newest first.
   - Write `assets/corpus/debunks.json` (2-space JSON, `Debunk[]`) and `assets/corpus/meta.json` (`{ builtAt: ISO, count, perPublisher, perRating }`).
   - Create `assets/corpus/demo-overrides.json` **only if it doesn't exist**. It's an array of `{ id, aliases?, claim?, rating?, summary? }` with 3 placeholder entries: ids `"REPLACE_ME_1"`..`"REPLACE_ME_3"`, `aliases: ["<Taglish paraphrase>"]`.
   - Print the summary: total, per publisher, per rating.
3. Run it: `node --experimental-strip-types scripts/pull-factchecks.ts`. Then check the corpus:
   - it should have at least 200 entries;
   - the file should be under 5 MB;
   - no key appears in any output file (`grep -c AIza assets/corpus/*` = 0).
   If a publisher returns 0 for everything, keep it in the config list and note it in the report.
4. Add a unit test `src/pipeline/__tests__/factcheckNormalize.test.ts` for `normalizeRating`: "MALI", "Hindi totoo", "Misleading", "Missing context", "Half true", "Not true", "True", "Totoo", "Satire", "Unproven" → other. Jest `roots` is `src`, so the test imports `../../../scripts/factcheck-normalize`.
5. Commit the script, the normalizer, the test and the three JSON files.

```json:metadata
{"files": ["scripts/pull-factchecks.ts", "scripts/factcheck-normalize.ts", "src/pipeline/__tests__/factcheckNormalize.test.ts", "assets/corpus/debunks.json", "assets/corpus/demo-overrides.json", "assets/corpus/meta.json"], "verifyCommand": "npx jest src/pipeline && npx tsc --noEmit -p . && node -e \"const d=require('./assets/corpus/debunks.json');if(d.length<200)process.exit(1);console.log(d.length)\"", "acceptanceCriteria": ["debunks.json has >=200 Debunk entries with rating in false|misleading|true", "meta.json has builtAt/count/perPublisher/perRating", "demo-overrides.json has 3 placeholder entries", "per query×site counts and unmapped ratings were logged; summary printed", "no API key in any committed file", "normalizer test passes"], "modelTier": "standard"}
```

### Task 2: Offline matcher

**Goal:** `matchOffline(claim)` returns a verdict plus the matched Debunk, with no network access.

**Steps:**
1. `src/pipeline/corpus.ts`:
   - export the `Debunk` type, verbatim from Global Constraints;
   - `export type DemoOverride = { id: string; aliases?: string[]; claim?: string; rating?: Debunk['rating']; summary?: string }`;
   - `export function mergeCorpus(base: Debunk[], overrides: DemoOverride[]): Debunk[]`. An override whose id matches merges its fields over the base entry, and its aliases are appended. Override ids not in base are ignored, which covers the `REPLACE_ME_*` placeholders;
   - `export function loadBundledCorpus(): { debunks: Debunk[]; builtAt: string }`, which `require`s the three JSON files under `assets/corpus/`. Metro and Jest both resolve `require` of JSON.
2. `src/pipeline/matchOffline.ts`:
   ```ts
   export const TOP_K = 8;
   export const MATCH_QUESTION = { kind: 'choice', instructions: 'Does the evidence support the claim?', criteria: { supports: '', contradicts: '', unrelated: '' } } as const;
   export type OfflineVerdict = 'supported' | 'contradicted' | 'unverified';
   export interface MatchCandidate { debunk: Debunk; text: string /* claim or alias that scored */; jaccard: number; probs?: Record<'supports'|'contradicts'|'unrelated', number> }
   export interface OfflineMatch { verdict: OfflineVerdict; confidence: number; reason: string; debunk?: Debunk; candidates: MatchCandidate[]; decisions: number; ms: number }
   export function trigrams(s: string): Set<string>   // reference impl from the brief, verbatim
   export function jaccard(a: Set<string>, b: Set<string>): number  // reference impl, verbatim
   export class OfflineMatcher {
     constructor(debunks: Debunk[])   // precomputes trigram sets for claim + each alias
     get size(): number
     prefilter(claim: string, k?: number): MatchCandidate[]  // best Jaccard per debunk over claim+aliases; top k by score; ties → newer date
     match(claim: string, engine: DecisionEngine, gate: number, signal?: AbortSignal, onDecision?: () => void): Promise<OfflineMatch>
   }
   ```
   - `match` calls `engine.systemOne(`Claim: ${claim}\nEvidence: ${c.text}`, { verdict: MATCH_QUESTION })` once per prefiltered candidate, sequentially. It calls `onDecision` after each call and stops early if `signal` aborts.
   - It takes `probabilities` from the ChoiceAnswer. Best candidate = highest p(supports).
   - Rule R2:
     - best p(supports) ≥ gate → verdict from rating (`true` → supported; else contradicted), `confidence` = p(supports), `reason` = `Matches a ${publisher} fact-check rated ${rating}`;
     - otherwise, if any candidate has p(contradicts) ≥ gate and contradicts is its argmax → `unverified`, `confidence` = that p, reason `Related fact-check found (post says the opposite)`, debunk attached;
     - otherwise → `unverified`, `confidence` = best p(supports) (0 if no candidates), reason `No known fact-check`, no debunk.
   - When `prefilter` returns zero candidates (all Jaccard = 0), skip the engine entirely.
   - `ms` = wall time of `match`.
3. `src/pipeline/__tests__/matchOffline.test.ts` uses a fake `DecisionEngine` whose `systemOne` returns probabilities from a lookup on the evidence text. No model, no network. Cases:
   1. exact-claim match on a `false` debunk → contradicted, debunk attached;
   2. alias match: the post text resembles only an alias → matched;
   3. best p(supports) 0.6 with gate 0.7 → unverified, "No known fact-check", no debunk;
   4. `true` rating → supported;
   5. contradicts-argmax ≥ gate → unverified with the "post says the opposite" reason and debunk attached;
   6. prefilter returns ≤ 8, ranked by Jaccard, and an unrelated post with 0 overlap makes 0 engine calls;
   7. `mergeCorpus` appends aliases and ignores unknown ids;
   8. `loadBundledCorpus()` returns > 0 entries and an ISO `builtAt`.
4. Commit.

```json:metadata
{"files": ["src/pipeline/corpus.ts", "src/pipeline/matchOffline.ts", "src/pipeline/__tests__/matchOffline.test.ts"], "verifyCommand": "npx jest src/pipeline && npx tsc --noEmit -p .", "acceptanceCriteria": ["OfflineMatcher API exactly as specified", "decision rule R2 implemented", "8 listed test cases pass with a fake engine", "no network or model in tests"], "modelTier": "standard"}
```

### Task 3: Measure the framing and the gate on ft3

**Goal:** evidence that the R1 framing works for claim-vs-claim matching, and a gate value chosen from data.

**Steps:**
1. Write `fixtures/match-eval.json`: about 40 items `{ id, post, debunkId, expect: 'match'|'opposite'|'none', lang: 'en'|'tl'|'taglish' }`, drawn from real `assets/corpus/debunks.json` entries:
   - 15 `match`: social-post-style paraphrases of a corpus claim. At least 6 Taglish/Filipino, with all-caps and "daw" style;
   - 5 `opposite`: the post asserts the negation;
   - 10 `none` hard negatives: the same topic as the nearest debunk but a different claim;
   - 10 `none` novel claims: nothing in the corpus. `debunkId` is null for these.
   The fixture is labelled `reviewStatus: 'draft'`.
2. Write `scripts/eval-match.ts`. It runs with `node --experimental-strip-types`, or as a Jest file under `src/pipeline/__tests__/` with `@jest-environment ./jest.ort-env.js` if loading the engine needs Jest's TS transform. Pick whichever works and say which in the report.
   - It loads `OnDeviceDecimaEngine` on onnxruntime-node with `modelDir: models/finetune/ft3/onnx-int8` (follow `src/engine/__tests__/engine.test.ts` for loading), builds an `OfflineMatcher` from the merged bundled corpus, and runs `match()` for every item at gate 0.
   - It reports:
     - prefilter recall: is the target debunk in the top 8?
     - for gates 0.5, 0.6, 0.7, 0.8, 0.9: precision and recall of `match`, the false-match rate on `none`, and the `opposite` handling;
     - mean decisions and mean ms per claim;
     - every failure, with its language.
   - It skips cleanly (exit 0 with a message) if the ft3 model dir is missing. The Jest variant must also skip when the model is missing, so `npx jest` stays green on a clean clone.
3. Write `docs/match-eval.md`: a table of the results, the recommended gate, and the Taglish failures. Do not change `DEFAULT_SETTINGS.gate`; report a recommendation only.
4. Commit.

```json:metadata
{"files": ["fixtures/match-eval.json", "scripts/eval-match.ts", "docs/match-eval.md"], "verifyCommand": "npx jest && npx tsc --noEmit -p .", "acceptanceCriteria": ["~40 eval items from real corpus entries incl. >=6 Taglish matches", "eval ran on ft3 int8 via onnxruntime-node", "per-gate precision/recall table and recommended gate in docs/match-eval.md", "per-claim latency reported", "Taglish failures listed"], "modelTier": "standard"}
```

### Task 4: Real check pipeline, corpus info, enrichment and network guard

**Goal:** `runCheck` runs extraction → `OfflineMatcher` → results with no network access, and `enrichClaim` does the R6 live lookup.

**Steps:**
1. `src/core/factcheckCache.ts`:
   - builds one module-level `OfflineMatcher` lazily from `loadBundledCorpus()`;
   - `corpusInfo()` returns `{ count: matcher.size, syncedAt: builtAt }`;
   - `matchCached(claim)` keeps its signature. It returns the prefilter's top candidates mapped to `EvidenceSource`, used by nothing else;
   - also exports `getMatcher()`.
2. `src/core/netGuard.ts`: `withNetworkGuard<T>(label: string, fn: () => Promise<T> | AsyncIterable…)`. Simplest form: `beginOfflineSection(label): () => { fetches: string[] }`.
   - In `__DEV__` it wraps `globalThis.fetch` and `XMLHttpRequest.prototype.open` once.
   - While a section is open, every call is recorded and logged with `console.warn('[net-guard] network call during offline check:', url)`.
   - Outside `__DEV__` it only records.
   - Add a Jest test with a fake fetch.
3. `src/core/checkPipeline.ts`: replace the mock bodies. Keep the exported signatures, `RunCheckOptions` (drop `speed` only if no test uses it; otherwise keep it as a no-op), and the event order exactly:
   `stage extract active → done → pending → stage match active → (progress, claim)* → stage match done → stage aggregate active → done → done event`.
   - Extraction follows R5: `opts.sentences ?? splitSentences(input).filter(s => mockClaimScore(s) >= 0.5)`.
   - Match: for each claim, `getMatcher().match(text, opts.engine, opts.gate, opts.signal, onDecision)`. Emit `progress` (done/total decisions, avgMs) per decision, or at least per claim. Total = Σ the prefilter size per claim, computed upfront.
   - Map `OfflineMatch` → `ClaimResult`:
     - `path: 'offline-match'`, `text` = the sentence;
     - `evidence` = the Debunk mapped as `{ url, publisher, domain: host(url), title: claim, tier: 'A', kind: 'factcheck', snippet: summary, stance: rating==='true' ? 'supports' : 'contradicts', confidence, date, claimReview: { rating, headline: claim } }`. When the post says the opposite, stance is the inverse;
     - `stats` = `{ engine, decisions, ms, rule: 'match ≥ gate on a saved fact-check', calibration: 'temperature-scaled' }`;
     - `enrichment: { status: 'idle' }` when unverified.
   - Wrap the whole run in a guard section, and set `CheckResult.networkUsed` = fetches.length > 0.
   - Delete `src/core/mockData.ts` once nothing imports it. Grep `src/ui` and `app` first. If the UI imports it, keep it.
4. `src/core/enrich.ts` + `enrichClaim` (R6):
   - `searchFactchecks(query, key, signal)` calls the claims:search endpoint with `pageSize=20` and maps results through `toDebunk` from `scripts/factcheck-normalize.ts` (same normalizer as Task 1).
   - `enrichClaim` emits the same event sequence as the mock:
     1. claim running "Searching published fact-checks…"
     2. retrieve stage
     3. claim running "Weighing evidence…"
     4. judge stage — run a fresh `OfflineMatcher(results).match(...)` with the claim's gate (from `check.gate`)
     5. the final claim, `path: 'live-search'`, `enrichment: { status: 'done' }`, evidence/verdict from the match, or reason "No published fact-check found online either" when there's no match
   - On a fetch error → `enrichment: { status: 'failed', message }`.
   - No `EXPO_PUBLIC_FACTCHECK_API_KEY` → failed with "Online enrichment needs an API key".
5. Tests:
   - update or keep `src/ui/__tests__/checkReducer.test.ts` green. If it relied on mock data or timing, adapt the test to inject a fake engine and keep its event-order assertions;
   - add `src/core/__tests__/checkPipeline.test.ts` with a fake engine and a fake corpus (allow injecting a matcher: `RunCheckOptions.matcher?: OfflineMatcher`). It asserts the event order, a match → contradicted claim with a factcheck evidence card, an unmatched claim → `enrichment.status === 'idle'`, and `networkUsed === false`;
   - add an `enrichClaim` test with a mocked fetch.
6. Commit.

```json:metadata
{"files": ["src/core/checkPipeline.ts", "src/core/factcheckCache.ts", "src/core/netGuard.ts", "src/core/enrich.ts", "src/core/mockData.ts", "src/core/__tests__/checkPipeline.test.ts", "src/core/__tests__/netGuard.test.ts", "src/ui/__tests__/checkReducer.test.ts"], "verifyCommand": "npx jest && npx tsc --noEmit -p .", "acceptanceCriteria": ["event order unchanged", "default path makes zero fetches (asserted)", "corpusInfo returns real count + builtAt", "enrichClaim uses live Fact Check search + same matcher; failure states handled", "all tests green"], "modelTier": "standard"}
```

### Task 5: Real engines, NetInfo and native deps

**Goal:** the app runs on the iPhone with real on-device Decima ft3 and real connectivity.

**Steps:**
1. Run `npm install` to pull the UI branch's new deps. Then `npm install @react-native-community/netinfo@<the version expo recommends>`: use `npx expo install @react-native-community/netinfo`, which pins it in package.json. Check that the patches re-apply.
2. `src/core/connectivity.ts`:
   - Back `isOnline` / `useIsOnline` with NetInfo (`isConnected && isInternetReachable !== false`), and **keep** the simulate-offline override: online = netinfo online && !simulated.
   - A module-level NetInfo subscription feeds a `createStore`.
   - In Jest, mock NetInfo, or guard so tests that import connectivity don't crash.
3. `src/core/engines.ts` `createEngine`, per R7:
   - `decima-local` loads `OnDeviceDecimaEngine` once and caches it, mirroring `src/spike/SpikeScreen.tsx` lines ~80–90: `ort` from `onnxruntime-react-native`, `modelDir().uri`, `readText`, `sessionPath` from `src/spike/modelStore.ts`, thread count as in the spike.
   - If `modelPresent()` is false, throw the R7 message.
   - `apple-on-device` reuses whatever the spike uses for `LlmDecisionEngine`, if it exists.
   - `lan`/`hosted` stay as they are.
   - Make sure `src/spike/reference.ts` `MODEL_VARIANT` resolves to ft3 for the product. If it reads `EXPO_PUBLIC_MODEL_VARIANT`, make the product default `'ft3'` without breaking the spike.
4. iOS:
   - run `cd ios && pod install`;
   - add `NSPhotoLibraryUsageDescription` ("CheckitFirst reads the screenshot you pick to find claims. It never leaves your phone.") to `ios/claimcheck/Info.plist` and to `app.json` `ios.infoPlist`, so a future prebuild keeps it;
   - build for the device with the xcodebuild command in `docs/HANDOFF.md` (Debug). Check `df -h ~` first and stop if under 6 GB.
   - Do not install or launch: the controller does that with the user.
5. Commit: package.json, package-lock, ios Podfile.lock / Info.plist / pbxproj if changed, connectivity and engines.

```json:metadata
{"files": ["package.json", "package-lock.json", "src/core/connectivity.ts", "src/core/engines.ts", "src/spike/reference.ts", "app.json", "ios/Podfile.lock", "ios/claimcheck/Info.plist"], "verifyCommand": "npx jest && npx tsc --noEmit -p . && test -d ios/build/Build/Products/Debug-iphoneos/claimcheck.app", "acceptanceCriteria": ["netinfo installed via expo install; pods installed; no prebuild", "connectivity = netinfo && !simulated", "createEngine('decima-local') loads ft3 from the on-device model dir, cached", "Info.plist has NSPhotoLibraryUsageDescription", "Debug iOS build succeeds"], "modelTier": "standard"}
```

### Task 6: DEMO.md

**Goal:** a demo script anyone can follow in airplane mode.

**Steps:**
1. `DEMO.md` contains:
   - **Setup.** Install the dev build, download ft3 to the device once (Settings → Developer → Phase 0 spike), then cold start once online so the JS bundle is cached. For a Debug build, Metro must stay reachable: note this honestly. Suggest an embedded-bundle Release build for a true offline run, if time allows.
   - **3 demo inputs**, chosen from real `assets/corpus/debunks.json` entries and the `fixtures/match-eval.json` results:
     1. a recycled hoax, written as Taglish screenshot text, that matched in the eval → expected Contradicted, with the publisher card;
     2. a true claim whose corpus rating is `true` → Supported. If the corpus has none or none matched, use a contradicts example and say so;
     3. a novel claim → Unverified, "No known fact-check", Online enrichment button disabled while offline, "Queued for recheck".
   - The `claimcheck://?text=…` deep link for each input.
   - **Airplane-mode checklist:** airplane mode on, kill the app, cold start, paste input 1/2/3, check the verdicts, the "Checked on-device against N saved fact-checks · synced <date>" line, no `[net-guard]` warnings in Metro logs; then turn airplane mode off and watch the queued enrichment run.
   - A table to fill in latency per claim.
   - Also fill the 3 `demo-overrides.json` placeholders with the Taglish aliases of the chosen demo debunks.
2. Commit.

```json:metadata
{"files": ["DEMO.md", "assets/corpus/demo-overrides.json"], "verifyCommand": "npx jest src/pipeline", "acceptanceCriteria": ["3 inputs grounded in real corpus entries with expected verdicts", "airplane-mode checklist", "latency table", "demo-overrides placeholders filled"], "modelTier": "standard"}
```

## After the tasks (controller with the user, not a subagent)

Install and launch on the iPhone. Run the airplane-mode checklist with the user, record latency per claim in DEMO.md, and report what works, what's stubbed, the corpus counts, latency and any Taglish matching failures.
