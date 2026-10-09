"""Phase 0 option-3 probe: fine-tune Decima-small for claim–evidence verdicts (supports / contradicts / unrelated).

    PYTORCH_ENABLE_MPS_FALLBACK=1 uv run --group train python finetune.py --run ft1

Data: English MNLI train (entailment→supports, contradiction→contradicts, neutral→unrelated, label-balanced) plus
harness/data/synthetic_ph.json (EN/Taglish/Filipino, upweighted). Ten synthetic claims are held out as the dev split
used to pick the checkpoint. fixtures/phase0.json is never read here: it is the held-out test set (eval_finetune.py).
Batches are built exactly like inference (DecimaConfig.state_of / choices_of), loss = NLL of the gold option.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import random
import re
import shutil
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from datasets import load_dataset
from decima.model import DecimaModel
from transformers import AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "models" / "decima-small" / "pytorch"
SYNTH = Path(__file__).resolve().parent / "data" / "synthetic_ph.json"
MNLI_TL = Path(__file__).resolve().parent / "data" / "mnli_tl.jsonl"  # translate_mnli.py (opus-mt-en-tl)
VARIANTS = ("tl/tl", "tl/en", "en/tl")  # claim language / evidence language
QUESTION = "Does the evidence support the claim?"
OPTIONS = ["supports", "contradicts", "unrelated"]
MNLI_MAP = {0: "supports", 1: "unrelated", 2: "contradicts"}


def state(claim: str, evidence: str) -> str:
    return f"Claim: {claim}\nEvidence: {evidence}"


def synthetic_split(rng: random.Random, n_dev: int = 10) -> tuple[list[dict], list[dict]]:
    claims = json.loads(SYNTH.read_text())["claims"]
    idx = list(range(len(claims)))
    rng.shuffle(idx)
    dev_idx, train_idx = set(idx[:n_dev]), idx[n_dev:]

    def examples(ids: list[int], pool: list[int]) -> list[dict]:
        out = []
        for i in ids:
            c = claims[i]
            out.append({"state": state(c["claim"], c["supports"]), "label": "supports", "src": "synth"})
            out.append({"state": state(c["claim"], c["contradicts"]), "label": "contradicts", "src": "synth"})
            if c.get("hardUnrelated"):
                out.append({"state": state(c["claim"], c["hardUnrelated"]), "label": "unrelated", "src": "synth"})
            # cross-topic unrelated: evidence from another claim in the same split
            for j in rng.sample([p for p in pool if p != i], 2):
                ev = claims[j][rng.choice(["supports", "contradicts"])]
                out.append({"state": state(c["claim"], ev), "label": "unrelated", "src": "synth"})
        return out

    dev_ids = sorted(dev_idx)
    return examples(train_idx, train_idx), examples(dev_ids, dev_ids)


def mnli(split: str, per_label: int) -> list[dict]:
    counts = {k: 0 for k in MNLI_MAP}
    out = []
    for r in load_dataset("nyu-mll/multi_nli", split=split, streaming=True):
        lab = r["label"]
        if lab not in counts or counts[lab] >= per_label:
            continue
        counts[lab] += 1
        out.append({"state": state(r["hypothesis"].strip(), r["premise"].strip()), "label": MNLI_MAP[lab], "src": "mnli"})
        if all(v >= per_label for v in counts.values()):
            break
    return out


def _clean_mt(t: str) -> str:
    # Marian output spaces out hyphens ("pag - iiski"); Filipino writes them closed ("pag-iiski")
    return re.sub(r"(\w) - (\w)", r"\1-\2", t)


def mnli_tl_split(dev_per_label: int = 100, split_seed: int = 0) -> tuple[list[dict], list[dict]]:
    """Translated MNLI pairs, split into train pairs and a fixed held-out dev set (independent of the training seed)."""
    rows = [json.loads(l) for l in MNLI_TL.read_text().splitlines() if l.strip()]
    for r in rows:
        r["premise_tl"], r["hypothesis_tl"] = _clean_mt(r["premise_tl"]), _clean_mt(r["hypothesis_tl"])
    rng = random.Random(split_seed)
    rng.shuffle(rows)
    dev, train, seen = [], [], {k: 0 for k in OPTIONS}
    for r in rows:
        if seen[r["label"]] < dev_per_label:
            seen[r["label"]] += 1
            dev.append(r)
        else:
            train.append(r)
    return train, dev


def tl_examples(r: dict, variant: str) -> dict:
    cl, ev = variant.split("/")
    claim = r["hypothesis_tl"] if cl == "tl" else r["hypothesis_en"]
    evidence = r["premise_tl"] if ev == "tl" else r["premise_en"]
    return {"state": state(claim, evidence), "label": r["label"], "src": f"mt:{variant}"}


def taglish_dev(split_seed: int = 13) -> list[dict]:
    """Selection set: held-out translated/code-mixed MNLI (one variant per pair, cycled) + non-English synthetic dev."""
    _, dev_pairs = mnli_tl_split()
    out = [tl_examples(r, VARIANTS[i % 3]) for i, r in enumerate(dev_pairs)]
    claims = json.loads(SYNTH.read_text())["claims"]
    non_en = {c["claim"] for c in claims if c["lang"] != "en"}
    _, sdev = synthetic_split(random.Random(split_seed))
    return out + [e for e in sdev if e["state"].split("\nEvidence: ")[0][len("Claim: "):] in non_en]


def make_batch(exs: list[dict], cfg, tok, device: str, rng: random.Random | None):
    """Like inference: one state per example, its options rendered with the question; option order shuffled when rng."""
    states, choices, gold = [], [], []
    for e in exs:
        opts = OPTIONS[:]
        if rng is not None:
            rng.shuffle(opts)
        states.append(cfg.state_of(e["state"], QUESTION, "en"))
        choices.extend(cfg.choices_of(tok, QUESTION, opts, "en"))
        gold.append(opts.index(e["label"]))
    s = tok(states, padding=True, truncation=True, max_length=cfg.max_state_tokens, return_tensors="pt")
    c = tok(choices, padding=True, truncation=True, max_length=cfg.max_choice_tokens, return_tensors="pt")
    B = len(exs)
    return {
        "s_ids": s["input_ids"].to(device), "s_mask": s["attention_mask"].to(device),
        "c_ids": c["input_ids"].to(device), "c_mask": c["attention_mask"].to(device),
        "owner": torch.arange(B, device=device).repeat_interleave(len(OPTIONS)),
        "kinds": ["choose"] * B,
    }, torch.tensor(gold, device=device)


@torch.no_grad()
def evaluate(model: DecimaModel, exs: list[dict], tok, device: str, bs: int = 32) -> dict:
    model.eval()
    correct, nll = 0, 0.0
    for i in range(0, len(exs), bs):
        batch, gold = make_batch(exs[i : i + bs], model.cfg, tok, device, None)
        Hs = model.encode(batch["s_ids"], batch["s_mask"])
        Hc = model.encode(batch["c_ids"], batch["c_mask"])
        s, z = model.choice_scores(Hs, batch["s_mask"], Hc, batch["c_mask"], batch["owner"])
        lp = model.log_probs(s, z, batch["owner"], len(gold), batch["kinds"], model.cfg.temperature)
        correct += int((lp.argmax(1) == gold).sum())
        nll += float(F.nll_loss(lp, gold, reduction="sum"))
    return {"acc": correct / len(exs), "nll": nll / len(exs), "n": len(exs)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="ft1")
    ap.add_argument("--mnli-per-label", type=int, default=1200)
    ap.add_argument("--synth-weight", type=int, default=5)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--max-state-tokens", type=int, default=192, help="training-time cap (fixture states are shorter)")
    ap.add_argument("--bs", type=int, default=16)
    ap.add_argument("--lr-enc", type=float, default=2e-5)
    ap.add_argument("--lr-head", type=float, default=1e-4)
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--split-seed", type=int, default=13, help="synthetic train/dev split (fixed across training seeds)")
    ap.add_argument("--tl-pairs", type=int, default=0, help="translated MNLI train pairs to use (0 = none, ft1 recipe)")
    ap.add_argument("--tl-variants-per-pair", type=int, default=2, help="of tl/tl, tl/en, en/tl, sampled per pair")
    ap.add_argument("--mnli-guard", type=float, default=0.70, help="min fp32 MNLI-val acc for a checkpoint to be selectable")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    torch.manual_seed(args.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    out = ROOT / "models" / "finetune" / args.run
    out.mkdir(parents=True, exist_ok=True)

    synth_train, synth_dev = synthetic_split(random.Random(args.split_seed))
    mnli_train = mnli("train", args.mnli_per_label)
    tl_train = []
    if args.tl_pairs:
        tl_pairs, _ = mnli_tl_split()
        for r in tl_pairs[: args.tl_pairs]:
            for v in rng.sample(VARIANTS, args.tl_variants_per_pair):
                tl_train.append(tl_examples(r, v))
    train = mnli_train + tl_train + synth_train * args.synth_weight
    tl_dev = taglish_dev(args.split_seed)
    mnli_val = mnli("validation_matched", 67)
    print(f"train: mnli-en {len(mnli_train)} + mnli-tl/mixed {len(tl_train)} + synth {len(synth_train)}×{args.synth_weight} = {len(train)}; "
          f"synth dev {len(synth_dev)}, taglish dev {len(tl_dev)}, mnli val {len(mnli_val)}", flush=True)

    tok = AutoTokenizer.from_pretrained(BASE / "encoder")
    model = DecimaModel.load(BASE, device=device)
    log = {"args": vars(args), "device": device, "sizes": {"mnli": len(mnli_train), "mnli_tl": len(tl_train), "synth_train": len(synth_train),
           "synth_dev": len(synth_dev), "taglish_dev": len(tl_dev), "mnli_val": len(mnli_val)}, "evals": []}

    def dev_all(tag: str) -> dict:
        r = {"synth": evaluate(model, synth_dev, tok, device), "taglish": evaluate(model, tl_dev, tok, device),
             "mnli_val": evaluate(model, mnli_val, tok, device)}
        print(f"{tag} synth-dev {r['synth']['acc']:.3f} | taglish-dev {r['taglish']['acc']:.3f} nll {r['taglish']['nll']:.3f} "
              f"| mnli-val {r['mnli_val']['acc']:.3f}", flush=True)
        return r

    base_dev = dev_all("base   ")
    log["evals"].append({"epoch": 0, **base_dev})

    # freeze the 96M-parameter vocab table: most of the optimizer memory, and too little data to move it usefully
    model.encoder.get_input_embeddings().weight.requires_grad_(False)
    enc = [p for n, p in model.named_parameters() if n.startswith("encoder.") and p.requires_grad]
    head = [p for n, p in model.named_parameters() if not n.startswith("encoder.")]
    opt = torch.optim.AdamW([{"params": enc, "lr": args.lr_enc}, {"params": head, "lr": args.lr_head}], weight_decay=0.01)
    train_cfg = copy.copy(model.cfg)
    train_cfg.max_state_tokens = args.max_state_tokens
    steps_per_epoch = math.ceil(len(train) / args.bs)
    total, warmup = steps_per_epoch * args.epochs, 30
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / warmup) * max(0.0, (total - s) / total))

    def key(r: dict) -> tuple:  # select on Taglish dev, MNLI-val as a guardrail
        return (r["mnli_val"]["acc"] >= args.mnli_guard, r["taglish"]["acc"], -r["taglish"]["nll"])

    best = key(base_dev)
    best_epoch = 0
    step, t0 = 0, time.time()
    for epoch in range(1, args.epochs + 1):
        rng.shuffle(train)
        model.train()
        running = 0.0
        for i in range(0, len(train), args.bs):
            batch, gold = make_batch(train[i : i + args.bs], train_cfg, tok, device, rng)
            loss = F.nll_loss(model(batch), gold)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            step += 1
            running = 0.98 * running + 0.02 * loss.item() if step > 1 else loss.item()
            if device == "mps" and step % 25 == 0:
                torch.mps.empty_cache()
            if step % 50 == 0:
                print(f"  step {step}/{total} loss {running:.3f} {(time.time() - t0) / step:.2f}s/step", flush=True)
        dev = dev_all(f"epoch {epoch}")
        print(f"  ({time.time() - t0:.0f}s)", flush=True)
        log["evals"].append({"epoch": epoch, **dev})
        ckpt = out / f"epoch{epoch}"
        model.cpu().save(ckpt)
        model.to(device)
        for f in ("tokenizer.json", "tokenizer_config.json"):
            shutil.copyfile(BASE / "encoder" / f, ckpt / "encoder" / f)
        if key(dev) > best:
            best, best_epoch = key(dev), epoch
        (out / "train_log.json").write_text(json.dumps(log, indent=1))

    log["best_epoch"] = best_epoch
    (out / "train_log.json").write_text(json.dumps(log, indent=1))
    print(f"best epoch on taglish dev (mnli-guarded): {best_epoch} (0 = base); checkpoints in {out}/epoch<n>", flush=True)


if __name__ == "__main__":
    main()
