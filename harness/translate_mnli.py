"""Machine-translate English MNLI train pairs into Tagalog for round-2 fine-tuning (ft2).

    PYTORCH_ENABLE_MPS_FALLBACK=1 uv run --group train python translate_mnli.py --per-label 1100

Model: Helsinki-NLP/opus-mt-en-tl (MarianMT, CC-BY-4.0). Source: nyu-mll/multi_nli train, rows after --skip
(so they differ from the English pairs finetune.py streams from the start of the split), label-balanced,
premise <= --max-words. Output cached to harness/data/mnli_tl.jsonl (one pair per line, en + tl text).
fixtures/phase0.json is never read.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from datasets import load_dataset
from transformers import MarianMTModel, MarianTokenizer

OUT = Path(__file__).resolve().parent / "data" / "mnli_tl.jsonl"
MODEL = "Helsinki-NLP/opus-mt-en-tl"
MNLI_MAP = {0: "supports", 1: "unrelated", 2: "contradicts"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-label", type=int, default=1100)
    ap.add_argument("--skip", type=int, default=20000)
    ap.add_argument("--max-words", type=int, default=45)
    ap.add_argument("--bs", type=int, default=48)
    args = ap.parse_args()

    counts = {k: 0 for k in MNLI_MAP}
    pairs = []
    for i, r in enumerate(load_dataset("nyu-mll/multi_nli", split="train", streaming=True)):
        if i < args.skip:
            continue
        lab = r["label"]
        if lab not in counts or counts[lab] >= args.per_label or len(r["premise"].split()) > args.max_words:
            continue
        counts[lab] += 1
        pairs.append({"mnli_idx": i, "genre": r["genre"], "label": MNLI_MAP[lab],
                      "premise_en": r["premise"].strip(), "hypothesis_en": r["hypothesis"].strip()})
        if all(v >= args.per_label for v in counts.values()):
            break
    print(f"selected {len(pairs)} pairs {counts}", flush=True)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    tok = MarianTokenizer.from_pretrained(MODEL)
    model = MarianMTModel.from_pretrained(MODEL).to(device).eval()
    texts = [p["premise_en"] for p in pairs] + [p["hypothesis_en"] for p in pairs]
    order = sorted(range(len(texts)), key=lambda k: len(texts[k]))  # length-bucketed batches
    out = [""] * len(texts)
    t0 = time.time()
    for b in range(0, len(order), args.bs):
        ids = order[b : b + args.bs]
        enc = tok([texts[k] for k in ids], return_tensors="pt", padding=True, truncation=True, max_length=256).to(device)
        with torch.no_grad():
            gen = model.generate(**enc, num_beams=4, max_new_tokens=256)
        for k, t in zip(ids, tok.batch_decode(gen, skip_special_tokens=True)):
            out[k] = t.strip()
        if (b // args.bs) % 10 == 0:
            print(f"  {b + len(ids)}/{len(texts)} {time.time() - t0:.0f}s", flush=True)
    n = len(pairs)
    with OUT.open("w") as f:
        for j, p in enumerate(pairs):
            p["premise_tl"], p["hypothesis_tl"] = out[j], out[n + j]
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    print(f"wrote {n} pairs to {OUT} in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
