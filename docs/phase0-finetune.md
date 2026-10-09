# Phase 0 fine-tune probe: Decima-small on claim–evidence verdicts

2026-10-09 · Bren Aviador · one run (`ft1`), about 2 minutes of training on an Apple M1 Pro (MPS).

> **Round 2 (`ft2`, below): Taglish stays at 4/10 and English drops back to 5/10 with 3,300 machine-translated Tagalog MNLI pairs. The gate is still not met.**

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
