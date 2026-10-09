# Phase 0 fine-tune probe: Decima-small on claim–evidence verdicts

2026-10-09 · Bren Aviador · one run (`ft1`), about 2 minutes of training on an Apple M1 Pro (MPS).

> **Round 2 (`ft2`, below): Taglish stays at 4/10 and English drops back to 5/10 with 3,300 machine-translated Tagalog MNLI pairs. The gate is still not met.**
>
> **Round 3 (`ft3`, below): with 2,193 claim/evidence pairs mined from VERA Files fact-checks, the fixtures reach English 7/10 and Taglish 6/10, exactly at the gate, on the one configuration chosen by dev. The margin is 0–1 item per language, so treat it as "at the gate", not "past it".**

**Result: fine-tuning moves English slightly (5 → 6 of 10) and leaves Taglish unchanged (4 → 4 of 10). Both are still below target (≥ 7 and ≥ 6), so this run doesn't unblock the accuracy gate.** It does show the training, export and int8 pipeline works end to end, with a drop-in model of the same size and I/O, so a better-data run can go straight into the app.

## What was trained

| Item | Value |
| --- | --- |
| Start point | `amyrmahdy/decima-small` PyTorch checkpoint (`models/decima-small/pytorch`); its fp32 output matches the shipped int8 model, argmax 20/20 |
| Framing | PRD Choice: `Claim: …\nEvidence: …`, "Does the evidence support the claim?", supports / contradicts / unrelated, option order shuffled per example |
| Data | 3,600 English MNLI train pairs, 1,200 per label (entailment → supports, contradiction → contradicts, neutral → unrelated); 159 synthetic PH fact-check pairs (`harness/data/synthetic_ph.json`, English / Taglish / Filipino), weighted ×5. 42 synthetic pairs held out as the dev split |
| Not used | XNLI (CC BY-NC); NewsPH-NLI (GPL-3.0, and binary same-article continuation, which isn't this task) |
| Training | 1 epoch, batch 16, AdamW (encoder 2e-5, head 1e-4), max state tokens 192, seed 13, MPS. Checkpoint picked on the synthetic dev split (epoch 1) |
| Export | `decima.export` → `decima.quantize` nbits8 (the shipped recipe). Re-exporting the untouched base this way reproduces the shipped model's fixture results exactly |
| Artifacts | `models/finetune/ft1/onnx-int8/` (same files, sizes and graph I/O as the shipped int8), `models/finetune/ft1/eval.json`, `harness/finetune.py`, `harness/eval_finetune.py` |

## Results (int8, ORT 1.24.4)

The 20 fixtures were held out: never trained on, never used to pick the checkpoint, evaluated once.

| Measure | Base (shipped) | Fine-tuned `ft1` | Target |
| --- | --- | --- | --- |
| Fixtures, English (of 10) | 5 | **6** | ≥ 7 |
| Fixtures, Taglish (of 10) | 4 | **4** | ≥ 6 |
| "supports" correct (of 6) | 0 | 2 | |
| "contradicts" correct (of 8) | 3 | 2 | |
| "unrelated" correct (of 6) | 6 | 6 | |
| Option-order flips | 0 | 0 | 0 |
| Synthetic dev split (42 pairs) | 0.57 | 0.83 | |
| MNLI validation_matched (201 pairs) | 0.62 | 0.73 | |

Per item:
- **English:** the model gained en-06 and en-07 ("supports") and lost en-02 ("contradicts" → "unrelated"). en-05 changed from one wrong answer to another ("supports" → "contradicts").
- **Taglish:** no item changed to the correct label. The Taglish "contradicts" pairs moved to "unrelated" with higher confidence (0.93–0.98).

## Reading it

- The model learned the task framing in English. It gained 11 points on MNLI validation and 26 points on the synthetic dev split, and it now answers "supports" at all. Only part of that carries over to the real English fixtures.
- It did not learn the Taglish verdicts. English MNLI was about 82% of the weighted training mix, and the 159 synthetic pairs, about half of them Taglish or Filipino, were too few to move the Taglish fixtures.
- n = 20 and the labels are still unreviewed, so ±1–2 items is noise.

## Caveats

- The same person (Claude) wrote the synthetic training pairs and the fixture labels. The topics were kept separate and the fixtures were held out, but the shared style can still bias the dev split upward. The 0.83 dev accuracy is optimistic for that reason.
- MNLI's licenses are mostly permissive with some share-alike parts. Check them before shipping a model trained on it.
- This was one run with no hyperparameter search.

## What would plausibly move Taglish

1. **More real Taglish training pairs.** A few hundred labelled claim–evidence pairs from PH fact-checks, or machine-translated MNLI into Filipino, reviewed by a Filipino speaker. This is the binding constraint, not compute: one epoch takes about 2 minutes.
2. **Rebalance the mix** toward Taglish/Filipino (for example 1:1 with English), and evaluate on a larger, reviewed fixture set (60+ items) so the gate means something.
3. If that doesn't reach ≥ 6 of 10, use the cloud-verdict path for Taglish (the parent PRD's HTTP `DecisionEngine`) and keep Decima on the phone for English and routing.

## Round 2 (`ft2`): machine-translated Tagalog MNLI

2026-10-09 · about 60 minutes · Apple M1 Pro (MPS).

**Result: Taglish did not move (4/10) and English fell back to the base's 5/10. The gate (Taglish ≥ 6, English ≥ 7) is not met.** Taglish dev accuracy rose from 0.54 to 0.68, but that gain did not carry over to the fixtures. The likely binding problem is the fact-check style of the pairs, not the language: 6 of 8 fixture "contradicts" items, in *both* languages, go to "unrelated", 5 of them at p ≥ 0.88.

Fixture evaluations used: **1 of 3**, on the single configuration chosen by dev (`models/finetune/ft2/CHOSEN.txt` was written before the evaluation). The same run re-scored base and ft1, which reproduced their round-1 numbers.

### Data built

| Set | Count | Source |
| --- | --- | --- |
| Translated MNLI pairs | 3,300 (1,100 per label) | MNLI train rows 20,000–23,751, premise ≤ 45 words, translated with `Helsinki-NLP/opus-mt-en-tl` (beam 4, 371 s on MPS). Cached in `harness/data/mnli_tl.jsonl`. These rows don't overlap the English MNLI rows used for training (rows from 0) or MNLI validation |
| ↳ train pairs | 3,000 | Each pair gives 2 of 3 variants, sampled per pair: Tagalog claim + Tagalog evidence, Tagalog claim + English evidence, English claim + Tagalog evidence → **6,000 examples** |
| ↳ Taglish dev pairs | 300 (100 per label) | Fixed split (seed 0, independent of the training seed); one variant per pair, cycled |
| English MNLI train | 4,500 (1,500 per label) | As in ft1 |
| Synthetic PH train | 159 × 4 = 636 | `synthetic_ph.json`, same split as ft1 |
| **Training mix** | **11,136** | 40% English MNLI, 54% Tagalog/code-mixed MT, 6% synthetic PH |
| Taglish dev (selection) | 325 | 300 MT dev + 25 non-English synthetic dev |
| MNLI validation (guardrail) | 201 | `validation_matched`, 67 per label, as in ft1 |

Code: `harness/translate_mnli.py` (new); `harness/finetune.py` (`--tl-pairs`, `--tl-variants-per-pair`, `--split-seed`, Taglish-dev selection with an MNLI guardrail, dev evaluated every epoch); `harness/eval_finetune.py` (`--int8`, `--no-fixtures`, `--no-base`, `--out`, Taglish dev). Marian's spaced hyphens ("pag - akit") are closed up when the data is loaded.

### Runs (fp32 dev, picked on Taglish dev)

All runs start from `models/decima-small/pytorch`, with batch 16, head lr 1e-4, max state tokens 192 and the mix above.

| Run | Encoder lr | Seed | Epochs | Taglish dev per epoch | MNLI val per epoch | Synthetic dev per epoch |
| --- | --- | --- | --- | --- | --- | --- |
| base | – | – | – | 0.532 | 0.622 | 0.571 |
| `ft2/a` | 2e-5 | 13 | 3 | **0.683** / 0.665 / 0.677 | 0.756 / 0.736 / 0.761 | 0.786 / 0.810 / 0.786 |
| `ft2/b` | 3e-5 | 13 | 2 | **0.686** / 0.671 | 0.761 / 0.766 | 0.810 / 0.810 |
| `ft2/c` | 3e-5 | 7 | 1 | **0.689** | 0.731 | 0.833 |

Epoch 1 was best in every run, and later epochs drifted down by about 1–2 points. The three configurations fall within 0.6 points of each other (n = 325, standard error about 2.6 points), so this is a plateau, which is why the round stopped at 60 of 90 minutes. The best epoch of each run was exported to int8. On int8 Taglish dev they score a 0.683 / b 0.680 / c 0.683; a and c tie, and the MNLI guardrail breaks the tie (0.756 vs 0.726). **Chosen: `ft2/a` epoch 1, at `models/finetune/ft2/onnx-int8/`.**

### Results (int8, ORT 1.24.4, `models/finetune/ft2/eval.json`)

| Measure | Base (shipped) | `ft1` | **`ft2`** | Target |
| --- | --- | --- | --- | --- |
| Fixtures, English (of 10) | 5 | 6 | **5** | ≥ 7 |
| Fixtures, Taglish (of 10) | 4 | 4 | **4** | ≥ 6 |
| "supports" correct (of 6) | 0 | 2 | 1 | |
| "contradicts" correct (of 8) | 3 | 2 | 2 | |
| "unrelated" correct (of 6) | 6 | 6 | 6 | |
| Option-order flips | 0 | 0 | 0 | 0 |
| Taglish dev (325) | 0.538 | 0.634 | **0.683** | |
| ↳ MT Tagalog / Tagalog | 0.60 | 0.63 | 0.61 | |
| ↳ MT Tagalog claim / English evidence | 0.48 | 0.64 | 0.74 | |
| ↳ MT English claim / Tagalog evidence | 0.53 | 0.59 | 0.67 | |
| ↳ synthetic non-English (25) | 0.56 | 0.80 | 0.80 | |
| Synthetic dev (42) | 0.571 | 0.833 | 0.786 | |
| MNLI validation (201) | 0.617 | 0.726 | **0.756** | ≥ 0.70 guardrail |
| Graph I/O same as shipped | ✓ | ✓ | ✓ | |

Confusion, label → prediction, for `ft2`: contradicts → contradicts 2, contradicts → unrelated 6, supports → supports 1, supports → contradicts 3, supports → unrelated 2, unrelated → unrelated 6.

Per item, against ft1: en-06 is lost ("supports" → "unrelated", at about 0.33 for each option), and tl-07 changes from one wrong answer to another ("unrelated" → "contradicts"). No other prediction changes. The 6 "contradicts" misses (en-02/03/04, tl-02/03/04) are all "unrelated", most of them at p ≥ 0.88.

### Every fixture evaluation this round

| # | Configuration | English | Taglish | Flips | Why it was run |
| --- | --- | --- | --- | --- | --- |
| 1 | `ft2/a` epoch 1 (int8) | 5/10 | 4/10 | 0 | Final model, chosen on Taglish dev before this evaluation |

The base and ft1 were re-scored in the same command (5/4 and 6/4, same as round 1). They are earlier models, not new configurations. No other fixture evaluation was run.

### Translation samples (5 random pairs, `random.Random(5)`)

| Label | English | Tagalog (opus-mt-en-tl) |
| --- | --- | --- |
| supports | P: Attractions here include some pleasant beaches, a vibrant nightlife, and the nearby ruins of Ephesus. H: Here visitors can enjoy beaches, nightlife, and ancient ruins close by. | P: Kabilang sa mga pang-akit dito ang ilang kaayaayang dalampasigan, isang masiglang buhay sa gabi, at ang kalapit na mga kagibaan ng Efeso. H: Dito ang mga bisita ay maaaring masiyahan sa mga dalampasigan, sa mga gabi, at sa sinaunang mga kagibaan sa malapit. |
| supports | P: yeah just just students H: Only students. | P: yoah mga estudyante lamang H: Mga estudyante lamang. |
| contradicts | P: I know change can be difficult, but I think we need to give it a chance, said Joyce Coleman, … H: Things need to stay exactly as they are, said Joyce Coleman who had been recently fired from her job. | P: Alam kong maaaring maging mahirap ang pagbabago, subalit sa palagay ko'y kailangan natin itong bigyan ng pagkakataon, sabi ni Joyce Coleman, … H: Ang mga bagay ay kailangang manatiling gayon, sabi ni Joyce Coleman na kamakailan ay inalis sa kaniyang trabaho. |
| supports | P: He swung and stabbed twice. H: He swung the sword and jabbed it forward twice. | P: Siya'y kumalantog at dalawang beses na nasaksak. H: Hinawakan niya ang tabak at makalawang ulit na sinaksak ito. |
| unrelated | P: The baron was also seriously thinking of replacing the triangular Place Dauphine's … architecture … H: The baron was sent to prison for defacing national treasures. | P: Ang baron ay seryoso ring nag-iisip na palitan ang triangle Place Dauphine's magiliw gabled at arcaded red-brick architecture … H: Ipinabilanggo ang barangay para sa pagpapawalang-bisa ng mga pambansang kayamanan. |

Quality is usable but uneven. The output reads in a formal, religious-text register ("subalit", "kaniyang", "makalawang ulit"), which is likely an effect of the model's OPUS training data. It mistranslates some phrases ("baron" → "barangay"; "stabbed" becomes the passive "nasaksak", so the evidence now says *he* was stabbed, which turns a "supports" pair into a likely contradiction), drops some words ("exactly"), and leaves hard English spans untranslated. None of this has been reviewed by a Filipino speaker.

### Licenses

| Item | License |
| --- | --- |
| `Helsinki-NLP/opus-mt-en-tl` (translation model) | CC-BY-4.0 |
| MNLI (`nyu-mll/multi_nli`), source of the English and translated pairs | Mostly OANC (permissive). Part of the fiction genre is CC BY-SA 3.0. 684 of the 3,300 translated pairs are fiction, so check share-alike before shipping |
| `harness/data/synthetic_ph.json` | Written in this project |
| Not used | NLLB (CC-BY-NC), XNLI (CC-BY-NC), NewsPH-NLI (GPL-3.0, and a different task) |

### Reading it, and caveats

- **The dev set doesn't predict the fixtures.** Most of the Taglish dev gain (+15 points) is on code-mixed MNLI, from the same distribution as the training data. The fixtures are fact-check claim and evidence pairs. The model labels their "contradicts" items "unrelated" in English as well as Taglish, so more Tagalog MNLI probably can't fix it. This is a hypothesis: it's read off the confusion matrix, not tested. Pure Tagalog/Tagalog MT dev barely moved (0.60 → 0.61).
- English slipped from 6 to 5. The only lost item, en-06, sits at chance (0.33 / 0.34 / 0.35). With n = 10 per language, ±1 is noise, and ft1 and ft2 aren't distinguishable on the fixtures.
- Machine translation is noisy (see the samples), and some labels likely flip in translation. The translations are unreviewed.
- I used 1 of the 3 allowed fixture evaluations and didn't evaluate the runners-up, so the fixture numbers can't have been picked by chance across configurations.
- **Next lever:** fact-check-style training pairs with refuting evidence, for example a few hundred claim/refutation pairs from PH fact-check articles (Tagalog and English), or "debunk" templates. More translated NLI won't do it. Otherwise, use the cloud-verdict path for Taglish, as recommended after round 1.

Artifacts: `models/finetune/ft2/onnx-int8/` (chosen), `models/finetune/ft2/eval.json`, `models/finetune/ft2/{a,b,c}/train_log.json`, the best epoch-1 checkpoint of each run (`{a,b,c}/epoch1`), int8 exports for b and c (`{b,c}/e1-onnx-int8`), and the logs in `models/finetune/ft2/*.log`.

## Round 3 (`ft3`): real PH fact-check pairs

2026-10-09/10 · about 75 minutes of active work (the session also sat stalled on an API rate limit for about 2¾ hours of wall-clock time, with nothing running) · Apple M1 Pro (MPS).

**Result: English 7/10 and Taglish 6/10 on the held-out fixtures, which meets the gate (≥ 7 and ≥ 6) with no margin.** Fact-check dev accuracy rose from 0.41 (base) to 0.77. The "contradicts → unrelated" failure from rounds 1–2 is mostly gone (5 of 8 → 1 of 8), but new errors replaced some of it: two Taglish "contradicts" items now go to "supports", and two "unrelated" items now go to "contradicts".

Fixture evaluations used: **1 of 3**, on `ft3/b` epoch 2. It was chosen on fact-check dev and written to `models/finetune/ft3/CHOSEN.txt` before the evaluation.

### Sources and scraping rules

| Source | Used? | Why |
| --- | --- | --- |
| VERA Files Fact Check, English section (WP category 2035) and Filipino section (category 2617) | **Yes**: the 500 + 400 most recent posts (2022-12 → 2026-10) | No `robots.txt` (404). Pages carry `index, follow` |
| Rappler Fact Check | **No** | Its `robots.txt` disallows `anthropic-ai`, `ClaudeBot`, `Claude-User`, `Claude-Web`, `GPTBot`, `CCBot`, `Google-Extended` and about 30 other AI agents. That is an explicit opt-out from AI use, so I didn't fetch any article pages, even under a generic User-Agent |
| AFP Fact Check | No | `robots.txt` returns 403 (bot wall). The brief said to use it only if easy |
| Tsek.ph | No | Aggregator, mostly links to the sources above |

How the data was fetched (`harness/mine_factcheck.py`):
- 9 requests in total to VERA Files' public WordPress REST endpoint (`/wp-json/wp/v2/posts`, 100 posts per request), ≥ 1.1 s apart, one at a time.
- User-Agent `claim-check-research/0.1 (non-commercial fact-check model research; contact …)`. No login, no paywall.
- Raw JSON and the mined pairs stay in `harness/data/factcheck/`, which is now in `.gitignore`. Every pair keeps its `source` URL, and `evidenceFrom` for unrelated pairs.

### Pairs built (`harness/build_factcheck_pairs.py`)

VERA Files articles have no "Claim: / Rating:" lines. They open with a lead that summarises the claim and gives the correction, quote the viral post in a `<blockquote>`, and then refute it. The mining is heuristic:

- **contradicts:** the claim is the quoted post or statement (`verbatim`, cut to its first ≤ 45 words) or the span after "claiming that … / nagsasabing …" in the lead (`article`). The evidence is 1–2 consecutive fact sentences from the lead, or from the first refuting body paragraph. The pair is kept only when the headline marks a debunk (NOT, FAKE, HINDI, WALANG, PEKE, AI-generated, …).
- **supports:** the claim is the headline with "FACT CHECK:" removed (`headline`; a fact-checker's own restatement such as "Video of building collapsing due to quake taken in Thailand, not in Davao Oriental"). The evidence is the same refuting sentences, which support the correction. Headlines that only rate a claim (MISLEADING, NEEDS CONTEXT, SATIRE, questions, round-ups) are skipped. I didn't hand-write any claims.
- **unrelated:** the claim with evidence from another article in the same split. "Hard" pairs share a WordPress tag (same broad topic), "random" pairs share none. Either way, pairs are dropped if the titles overlap (Jaccard > 0.25) or the evidence contains > 20% of the claim's content words.

| Count | Value |
| --- | --- |
| Posts downloaded | 900 (500 English section, 400 Filipino section) |
| Articles dropped by the contamination guard | 244: 6 fixture URLs + 238 event-blocklist hits (Duterte/ICC 114, Senate President/Sotto/Legarda 32, Bato 23, Remulla 19, Marcos resign 18, national-ID ayuda 11, BSKE 10, Zamboanga/Facebook ban 5, OFW ₱150K 4, quake forecast 2) |
| Articles without usable evidence | 49 |
| Usable articles | 607 → 486 train / 121 dev, split by article (seed 3) |
| Pairs dropped by the pair-level guard | 35: 30 event-keyword hits in claim or evidence, plus 5 that shared an 8-word shingle with a fixture string |
| **Pairs kept** | **2,193**: 1,786 train / 407 dev |
| By label | supports 625 · contradicts 741 · unrelated 827 (dev: 126 / 133 / 148) |
| By kind | refute-lead 287 · refute-body 454 · headline-lead 265 · headline-body 360 · unrelated-hard 373 · unrelated-random 454 |
| By claim source | headline 1,027 · verbatim 728 · article 438 |
| By source section | English section 1,382 · Filipino section 811 |
| Language (claim/evidence, by function-word ratio) | en/en 797 · tl/tl 646 · tl/en 394 · en/tl 215 · mixed (any side) 141. **64% of pairs have a Filipino or Taglish side** |

This is above the brief's 400–1,000 target. I kept all of it rather than subsample, because the dev set is article-split and the extra pairs come from more articles, not repeats.

The guard (event keywords, broad on purpose) runs at article level on the title and lead, and again at pair level on claim and evidence. The script then **asserts** that no pair contains a fixture claim or evidence string, or any 8-word shingle of one, and that no pair's `source` or `evidenceFrom` is a fixture URL. Rappler fixture articles weren't fetched at all.

The 407 dev pairs are also written separately to `harness/data/factcheck/dev.jsonl` (git-ignored), for comparing other models on the same unseen pairs.

### Ten random pairs (`random.Random(2026)`, for human review)

| Label (kind) | Verdict on the label |
| --- | --- |
| supports (headline-body) | ok |
| contradicts (refute-body) | ok-ish (the claim span lost its subject, "a dam collapse") |
| unrelated (hard) | ok |
| unrelated (random) | ok |
| contradicts (refute-lead) | ok, but a bare verdict sentence |
| supports (headline-body) | weak, closer to unrelated |
| unrelated (random) | ok |
| unrelated (hard) | ok |
| unrelated (random) | ok |
| supports (headline-lead) | ok |

I'd call about 8 of 10 clean. From a wider read of about 60 pairs, I estimate label noise at 10–20%. The usual problems are headline "supports" pairs whose evidence is only background, claim spans cut short at an abbreviation, and bare verdict sentences ("This is fake.") used as evidence. The labels have not been reviewed by a person.

The claim and evidence text is left out here because VERA Files marks its content "All Rights Reserved" and this repo is public. The full pairs are in the local, git-ignored `models/finetune/ft3/sample_pairs.jsonl` (and `harness/data/factcheck/`).

### Runs (fp32 dev, picked on fact-check dev)

Mix in every run: 1,500 English MNLI train (500 per label) + 1,500 translated MNLI pairs (1 variant each, from `mnli_tl.jsonl`) + 1,786 fact-check train pairs × weight. No synthetic PH pairs. Batch 16, head lr 1e-4, max state tokens 192, frozen vocab table, all from `models/decima-small/pytorch`. Selection: fact-check dev accuracy, with MNLI validation ≥ 0.70 as a guardrail.

| Run | fc weight | Encoder lr | Seed | Examples | Fact-check dev per epoch (407) | MNLI val per epoch | Taglish dev per epoch |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base | – | – | – | – | 0.410 | 0.622 | 0.532 |
| `ft3/a` | ×4 | 2e-5 | 13 | 10,144 | 0.725 / **0.740** | 0.711 / 0.731 | 0.603 / 0.631 |
| `ft3/b` | ×5 | 2e-5 | 13 | 11,930 | 0.747 / **0.762** / 0.740 | 0.711 / 0.731 / 0.726 | 0.622 / 0.652 / 0.658 |
| `ft3/c` | ×5 | 3e-5 | 7 | 11,930 | **0.762** / 0.749 | 0.706 / 0.711 | 0.618 / 0.643 |

Unlike round 2, epoch 2 was best for the 2e-5 runs. Dev NLL rises after epoch 1 in every run (for example b: 0.73 → 1.04 → 1.52), so the model gets more confident faster than it gets more accurate. On int8 fact-check dev the best epochs score a/e2 0.740, **b/e2 0.769** and c/e1 0.759. b/e2 also has the better MNLI guardrail (0.731 vs 0.706). **Chosen: `ft3/b` epoch 2, at `models/finetune/ft3/onnx-int8/`.** b and c are 1 point apart (standard error about 2 points), which is within noise.

### Results (int8, ORT 1.24.4, `models/finetune/ft3/eval.json`)

| Measure | Base (shipped) | `ft1` | `ft2` | **`ft3`** | Target |
| --- | --- | --- | --- | --- | --- |
| Fixtures, English (of 10) | 5 | 6 | 5 | **7** | ≥ 7 |
| Fixtures, Taglish (of 10) | 4 | 4 | 4 | **6** | ≥ 6 |
| "supports" correct (of 6) | 0 | 2 | 1 | **4** | |
| "contradicts" correct (of 8) | 3 | 2 | 2 | **5** | |
| "unrelated" correct (of 6) | 6 | 6 | 6 | **4** | |
| Option-order flips | 0 | 0 | 0 | **0** | 0 |
| Fact-check dev (407) | 0.410 | 0.418 | 0.425 | **0.769** | |
| ↳ English pairs (162) | 0.315 | 0.340 | 0.340 | 0.753 | |
| ↳ Filipino/Taglish pairs (245) | 0.473 | 0.469 | 0.482 | 0.780 | |
| ↳ per label s / c / u | 0.06 / 0.29 / 0.82 | 0.15 / 0.16 / 0.88 | 0.16 / 0.23 / 0.83 | 0.80 / 0.75 / 0.76 | |
| Taglish dev (325) | 0.538 | 0.634 | 0.683 | 0.662 | |
| Synthetic dev (42) | 0.571 | 0.833 | 0.786 | 0.810 | |
| MNLI validation (201) | 0.617 | 0.726 | 0.756 | **0.731** | ≥ 0.70 guardrail |
| Graph I/O same as shipped | ✓ | ✓ | ✓ | ✓ | |

Confusion, label → prediction, for `ft3`: contradicts → contradicts 5, → supports 2, → unrelated 1; supports → supports 4, → contradicts 2; unrelated → unrelated 4, → contradicts 2.

Per item, against the base:
- **Gained (7):**
  - en-03, en-04, tl-04 (contradicts, all previously "unrelated")
  - en-06, tl-06 (supports, at p ≥ 0.96)
  - tl-05, tl-07 (supports, at only p = 0.43 and 0.53)
- **Lost (3):**
  - en-08 and tl-10, "unrelated" → "contradicts" at p ≥ 0.99. Both pair a claim with a background sentence that has a negating, debunk-like tone.
  - tl-01, "contradicts" → "supports" at p = 0.99. Its evidence restates the claim's words ("no … ban starting September 10 or any penalty").
- **Still wrong:**
  - en-05 (supports → contradicts) and en-07 (supports → contradicts at p = 0.52)
  - tl-02 (→ unrelated)
  - tl-03 (contradicts → supports: the evidence quotes the ₱150,000 rumour before saying it is "HINDI TOTOO")

### Every fixture evaluation this round

| # | Configuration | English | Taglish | Flips | Why it was run |
| --- | --- | --- | --- | --- | --- |
| 1 | `ft3/b` epoch 2 (int8) | 7/10 | 6/10 | 0 | Final model, chosen on fact-check dev before this evaluation |

The base, ft1 and ft2 were re-scored in the same command and reproduced their earlier numbers. They are earlier models, not new configurations. I didn't run evaluations 2 or 3: the gate was met, and evaluating the runners-up would only add selection noise.

### Licensing and terms

| Item | Terms | Notes |
| --- | --- | --- |
| VERA Files articles (training text) | "© VERAFILES, INC. All Rights Reserved. Use of this site constitutes acceptance of our Terms of Service". I couldn't find a Terms of Service page: the footer doesn't link one, and the WP pages API search turned up nothing | No robots.txt restrictions and no AI opt-out found. The text is stored locally only and never committed. **The fine-tuned weights are derived from all-rights-reserved text: get permission from VERA Files (or legal review) before shipping `ft3`.** VERA Files is an IFCN signatory and a Meta third-party fact-checker, so asking for a research/data licence is a reasonable path |
| Rappler | Opted out of AI crawlers in robots.txt | Not used |
| MNLI / translated MNLI | As in round 2 (OANC + some CC BY-SA fiction) | 1,500 + 1,500 pairs this round |

### Reading it, and caveats

- **In-domain data was the lever, as round 2 suspected.** The model now uses refutation wording ("no official reports", "the photo is from …") as "contradicts" instead of "unrelated". Fact-check dev nearly doubled (0.41 → 0.77) in both languages.
- **The gate is met with zero margin, and n = 10 per language.** Two of the Taglish gains (tl-05, tl-07) sit at p ≈ 0.43–0.53, and losing either one drops Taglish to 5/10. The gate result is real under the protocol (one pre-registered evaluation), but it isn't robust evidence that the model is ≥ 60% on Taglish fact-checks. Fact-check dev (407 pairs, 77–78% on both languages) is the better estimate, with the caveats below.
- **New failure modes:**
  - The model over-calls "contradicts" for any evidence with debunk tone (en-08, tl-10).
  - It calls "supports" when refuting evidence repeats the claim's words (tl-01, tl-03). The "supports" training pairs are headline/evidence pairs with high word overlap, which likely taught an overlap shortcut.
  - In training, "supports" pairs almost never mix languages (3%), while 38% of "contradicts" and 48% of "unrelated" pairs do. That's another possible shortcut.
- **Dev is optimistic:** it was mined with the same heuristics, from the same outlet and house style as train (but different articles). Labels are heuristic and unreviewed (an estimated 10–20% noise). The fixtures are partly Rappler-sourced, so they serve as a check across outlets.
- MNLI validation fell from 0.756 (ft2) to 0.731, and Taglish (MT-MNLI) dev from 0.683 to 0.662, both still above ft1. That is the expected cost of shrinking the general-NLI share from 94% to 25% of the mix.
- **Contamination:** the event blocklist is broad: it removed every article that mentions the ICC, the Senate President, Bato, BSKE and so on. The fixture-shingle assertion passes. Mined text can still share a *topic* with the fixtures (Duterte family, OVP, AI-generated videos). It cannot share the events the fixtures are about.
- **Next:**
  1. Have a Filipino speaker review the ~400 dev pairs and the 20 fixtures.
  2. Add hand-checked "supports" pairs whose evidence doesn't copy the claim's wording, plus same-article "unrelated" negatives.
  3. Get VERA Files' permission, and consider asking Rappler for the same, before any of this ships.

Artifacts:
- `models/finetune/ft3/onnx-int8/` (chosen) and `models/finetune/ft3/eval.json`
- `CHOSEN.txt`, `fixture_eval_1.log` and `pairs_stats.json`
- `{a,b,c}/train_log.json`, the best checkpoint of each run (`a/epoch2`, `b/epoch2`, `c/epoch1`) and their int8 exports (`*/e*-onnx-int8`)
- code: `harness/mine_factcheck.py`, `harness/build_factcheck_pairs.py`, plus `harness/finetune.py` (`--fc-weight`, `--select fc`, `--tl-offset`) and `harness/eval_finetune.py` (fact-check dev)
- mined data, local and git-ignored: `harness/data/factcheck/{raw/,pairs.jsonl,dev.jsonl}`
