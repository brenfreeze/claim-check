# Fine-tune round 2 (ft2+): get Taglish to the Phase 0 bar

**Goal:** Fine-tune Decima-small so the held-out Phase 0 fixtures reach **Taglish ≥ 6/10**, keeping **English ≥ 7/10**, without tuning on the fixtures.

**Timebox:** 90 minutes of work. You may extend by up to 30 minutes only if the Taglish dev metric is still clearly rising. Then stop and report, whatever the outcome.

## Where things stand (round 1, `ft1`)

- Code: `harness/finetune.py` (training; uses `decima.model.DecimaModel`, `DecimaConfig.state_of/choices_of`, NLL over the gold option, option order shuffled, MPS), `harness/eval_finetune.py` (int8 eval: fixtures, synthetic dev, MNLI validation, base vs fine-tuned), `harness/data/synthetic_ph.json` (48 claims, en/taglish/tl, supports/contradicts/hardUnrelated). Read both scripts before changing anything.
- `ft1` args: 1,200 MNLI per label (3,600), 159 synthetic train ×5, 1 epoch, bs 16, lr encoder 2e-5 / head 1e-4, max_state_tokens 192, seed 13. One epoch takes about 2 minutes on MPS.
- `ft1` results (int8, `models/finetune/ft1/eval.json`): English fixtures 5 → **6**/10, Taglish 4 → **4**/10. Synthetic dev 0.57 → 0.83. MNLI validation 0.62 → 0.73. On Taglish "contradicts" fixtures the model got *more* confident in "unrelated". Write-up: `docs/phase0-finetune.md`.
- Diagnosis: the Taglish signal was starved. English MNLI was about 82% of the weighted mix, and there were only about 80 Taglish/Filipino synthetic pairs. Data is the bottleneck, not epochs.
- Export pipeline (proven): `uv run python -m decima.export <ckpt> --out <run>/onnx-fp32`, then the `decima.quantize` default nbits8 recipe → `<run>/onnx-int8`. Re-exporting the base this way reproduces the shipped model exactly.

## What to do, in order of expected value

1. **Tagalog training data by machine translation.**
   - Translate about 2,000–4,000 English MNLI train pairs (balanced across the 3 labels; not the pairs used for MNLI validation) into Tagalog. Run the model locally on MPS or CPU.
   - Model preference: `Helsinki-NLP/opus-mt-en-tl` (MarianMT, CC-BY-4.0). If it's unavailable or clearly broken, use `facebook/m2m100_418M` (MIT).
   - **Do not use NLLB:** it's CC-BY-NC.
   - Install with `uv add --group train sentencepiece sacremoses` (or whatever the tokenizer needs) in `harness/`.
   - Print 5 random translations in your report so a human can judge the quality.
   - Batch the translation and cache it to `harness/data/mnli_tl.jsonl`.
2. **Code-mixed variants that match the fixtures**, whose claims are often Taglish/Filipino while the evidence is English or Filipino. From the translated pairs build: Tagalog claim + English evidence, English claim + Tagalog evidence, and Tagalog + Tagalog. Use the PRD framing (`Claim: …\nEvidence: …`, "Does the evidence support the claim?", supports/contradicts/unrelated).
3. **Rebalance** to roughly 50% English and 50% Tagalog or code-mixed in the training mix. Keep the synthetic PH pairs (×3–5).
4. **Training:** 2–3 epochs, with checkpoint selection after every epoch, and a small sweep if time allows (encoder lr 2e-5 vs 3e-5; seed 13 vs 7). Start from the base PyTorch checkpoint `models/decima-small/pytorch`, not from ft1, unless you have a reason.
5. **A Taglish dev set for selection, never the fixtures:** the held-out synthetic Taglish/Filipino pairs plus about 300 held-out translated or code-mixed pairs. Select on Taglish dev accuracy, with English (MNLI validation) as a guardrail. Don't accept a model whose MNLI validation drops below ft1's 0.73 by more than 0.03.

## The held-out fixtures: protect the test set

- `fixtures/phase0.json` (20 items) is the test set. **Never train on it.** Never use it to pick checkpoints, learning rates or data mixes.
- Evaluate a configuration on the fixtures **only once it's final** (picked by dev), with at most **3 fixture evaluations in total** across the whole round. Report **every** fixture evaluation you ran, including failures. Stopping "because the fixtures hit the target" would be selecting on the test set: don't do it. Stop on the timebox or the dev plateau.
- Export the chosen model(s) to int8 and evaluate with `harness/eval_finetune.py` (extend it to take the new run's path). Report English/Taglish fixture accuracy, per-label confusion, order flips (must be 0), synthetic dev, Taglish dev, and MNLI validation, for base, ft1 and the new model(s).

## Constraints

- Write only under `harness/`, `models/finetune/`, and `docs/phase0-finetune.md`. **Do not touch** `src/`, `App.tsx`, `package.json`, `package-lock.json`, `node_modules/`, `patches/`, `docs/phase0-results.md`, `fixtures/`, or `models/decima-small/`: another agent is committing code fixes there right now. Don't run git commands that change state (no commits, no staging). Don't touch the Android emulator.
- No XNLI (CC-BY-NC), no NewsPH-NLI (GPL, wrong task), no NLLB (NC).
- Record the license of every data source and model you use in the doc.

## Deliverables

- `models/finetune/<run>/onnx-int8/` for the chosen model, plus `eval.json`.
- Update `docs/phase0-finetune.md` with a round-2 section: data built (with counts), runs (args), a table of base / ft1 / ft2 results, every fixture evaluation done, 5 translation samples, licenses, and caveats. Keep the doc's voice: lead with the answer, tables over prose.
- Final message, at most 10 lines: did Taglish reach ≥ 6/10 and English ≥ 7/10, the chosen run's path, the number of fixture evaluations used, and concerns.
