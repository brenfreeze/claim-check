# Fine-tune round 3 (ft3): train on real PH fact-check pairs

**Goal:** Fine-tune Decima-small on *in-domain* claim/evidence pairs mined from real Philippine fact-checks, so the held-out fixtures reach **Taglish ≥ 6/10 and English ≥ 7/10**.

**Timebox:** 120 minutes. Stop and report then, whatever the outcome.

## Why this round

- Rounds 1 and 2 (`docs/phase0-finetune.md`) trained on general NLI (English MNLI, plus MNLI machine-translated to Tagalog). The held-out fixtures didn't move: base 5/4, ft1 6/4, ft2 5/4 (English/Taglish of 10).
- The failure is a task convention. Fact-checks refute claims with statements like "there is no official announcement…", "PSA has not issued…", or "the photo is from 2019". NLI data calls "no evidence of X" *neutral*, so the model answers "unrelated". 6 of 8 fixture "contradicts" items go to "unrelated" in both languages, mostly at p ≥ 0.88.
- Even "is this evidence about the claim?" scores 3–4/10 zero-shot. The model needs examples of exactly this genre.

## Data to build (the core of this round)

**Sources:** public PH fact-check articles.
- Rappler Fact Check (rappler.com/newsbreak/fact-check), mostly English, with Taglish viral claims quoted verbatim.
- VERA Files Fact Check, both the English section and the Filipino section (verafiles.org/section/fact-check-filipino).
- AFP Fact Check Philippines and Tsek.ph only if easy.

Many articles have a structured top: "Claim: …", a rating, "The facts: …" or the VERA Files bolded claim/verdict lines.

**Scraping rules (non-negotiable):**
- Check each site's `robots.txt` and respect it.
- At most 1 request/second per site, with a descriptive User-Agent.
- No logins and no paywalls.
- Store raw HTML and extracted text **only locally**, under `harness/data/factcheck/`. Add that path to `.gitignore`. Never commit mined text: the repo is public.
- Record each source URL alongside its pair.

**Pairs to build** (PRD framing: `Claim: …\nEvidence: …`, "Does the evidence support the claim?", supports/contradicts/unrelated):
- **contradicts:** claim = the article's claim line, or the viral post quoted verbatim. Evidence = 1–3 consecutive sentences from the facts section that refute it.
- **supports:** these are rarer.
  - Use articles rated accurate or true where they exist.
  - Otherwise pair a sentence that states a verified fact from an article's facts section (e.g. "Sotto remains Senate President") with a claim that restates it. You may write that short restating claim yourself, but keep a `claimSource` field (`verbatim` / `paraphrase`) as `fixtures/phase0.json` does.
- **unrelated:**
  - A claim with evidence from a different article.
  - Plus a "hard" variant: same broad topic (both about ayuda, or both about the Senate), but the evidence doesn't address this claim.
- **Volume target:** 400–1,000 pairs, at least 40% with a Filipino or Taglish claim or evidence, and labels roughly balanced (upweight supports if scarce).
- Print 10 random pairs in the report for human review.

## Contamination guard (critical)

`fixtures/phase0.json` is the held-out test set. Its items come from these articles; read the `source` and `claimFrom` fields for the exact URLs. **Exclude** every one of those URLs, **and** any other article about the same events. Build an event blocklist from the fixture claims:
- the Remulla DILG removal and the Remulla Muslims/Visayans quote;
- the Sept 21–22 earthquake forecast map;
- the BSKE postponement bill and filing of candidacy;
- Duterte's release in July 2026 and the ICC dismantling;
- the Zamboanga shooting and the Facebook ban;
- Marcos resigning;
- P150K OFW ayuda;
- the P25K national ID ayuda;
- Bato being removed from the Senate;
- Legarda as Senate President, and Sotto.

Drop any pair whose claim or evidence matches the blocklist by keyword. Also assert in code that no fixture claim or evidence string, or any 8-word shingle of one, appears in the training data. Report the count of pairs dropped by the guard.

## Training

- Start from `models/decima-small/pytorch` (base), reusing `harness/finetune.py` and extending it as needed. Read it and `harness/eval_finetune.py` first.
- Mix: the in-domain fact-check pairs upweighted (×3–5), plus a small share of English MNLI (about 1,500) and Tagalog MT MNLI (about 1,500, from `harness/data/mnli_tl.jsonl`) to keep the model general.
- Split the in-domain pairs **by article**: about 20% of articles go to a fact-check dev set used for checkpoint selection, with no article in both train and dev. Select on fact-check dev accuracy, with MNLI validation as a guardrail (don't drop below 0.70).
- 1–3 epochs, as before. Epoch 1 was best previously, so check per epoch.

## Fixture evaluations

At most **3 in total**, only on configurations already chosen by dev. Write the choice to `models/finetune/ft3/CHOSEN.txt` *before* each evaluation. Report every evaluation. Don't keep iterating because the fixtures miss.

## Deliverables

- `models/finetune/ft3/onnx-int8/` (same graph I/O as the shipped model; order flips must be 0) and `models/finetune/ft3/eval.json`: base / ft1 / ft2 / ft3 on fixtures, fact-check dev, Taglish dev and MNLI validation.
- A round-3 section in `docs/phase0-finetune.md`, in the doc's existing voice:
  - data mined (counts per source, per label, per language), the scraping rules followed, and the guard's drop count;
  - runs, a results table, every fixture evaluation, and 10 sample pairs;
  - licensing and terms notes per source.
- Disk: keep only the best checkpoint per run, delete fp32 exports after quantizing, and check `df -h ~` before writing more than 1 GB. Stop if free space would drop below 3 GB.

## Constraints

- Write only under `harness/`, `models/finetune/`, `docs/phase0-finetune.md` and `.gitignore` (for the data path).
- Do not touch `src/`, `App.tsx`, `ios/`, `android/`, `package*.json`, `node_modules/`, `fixtures/` or `models/decima-small/`. Another workstream is designing the app's cloud path.
- Do not run git commands that change state.
- Final message, at most 10 lines: gate met or not, chosen run path, fixture evaluations used, data counts, and concerns.
