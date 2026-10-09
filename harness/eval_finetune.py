"""Evaluate int8 exports side by side on the held-out fixtures (once), the synthetic dev split, the Taglish dev set
and MNLI validation.

    uv run --group train python eval_finetune.py --run ft1
    uv run --group train python eval_finetune.py --run ft2 --int8 ft2/a-e2/onnx-int8 --no-fixtures   # dev only
    uv run --group train python eval_finetune.py --run ft2 --int8 ft2/a-e2/onnx-int8 --extra "ft1 (round 1)=models/finetune/ft1/onnx-int8"

Every run WITHOUT --no-fixtures is a fixture evaluation of each new model in it: round 2 allows at most 3, all reported.

Uses DecimaOnnx, the same runtime path as export_reference.py and the TypeScript engine.
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

import numpy as np
import onnxruntime as ort
from decima.runtime import DecimaOnnx
from decima.types import Question
from finetune import OPTIONS, QUESTION, mnli, synthetic_split, taglish_dev

ROOT = Path(__file__).resolve().parent.parent
ORDERS = {"canonical": [0, 1, 2], "reversed": [2, 1, 0], "rotated": [1, 2, 0]}


def predict(rt: DecimaOnnx, st: str, opts: list[str]) -> tuple[str, list[float]]:
    lp = rt.decide_logits(st, Question(QUESTION, opts))
    p = np.exp(lp - lp.max()); p /= p.sum()
    return opts[int(np.argmax(p))], p.tolist()


def eval_model(path: Path, fixtures: list[dict], dev: list[dict], mnli_val: list[dict], tl_dev: list[dict]) -> dict:
    rt = DecimaOnnx(path, threads=1)
    io = {g: ([i.name for i in s.get_inputs()], [o.name for o in s.get_outputs()]) for g, s in (("encoder", rt.enc), ("scorer", rt.sc))}
    items, conf, flips = [], Counter(), 0
    for it in fixtures:
        st = f"Claim: {it['claim']}\nEvidence: {it['evidence']}"
        answers = {name: predict(rt, st, [OPTIONS[i] for i in order]) for name, order in ORDERS.items()}
        pred, p = answers["canonical"]
        flips += len({a for a, _ in answers.values()}) > 1
        conf[(it["label"], pred)] += 1
        items.append({"id": it["id"], "lang": it["lang"], "label": it["label"], "pred": pred, "p": [round(x, 3) for x in p]})
    acc = {lang: sum(r["pred"] == r["label"] for r in items if r["lang"] == lang) for lang in ("en", "tl")}
    tl_preds = [(predict(rt, e["state"], OPTIONS)[0], e) for e in tl_dev]
    tl_acc = float(np.mean([p == e["label"] for p, e in tl_preds])) if tl_dev else None
    tl_by_src = {src: float(np.mean([p == e["label"] for p, e in tl_preds if e["src"] == src]))
                 for src in sorted({e["src"] for e in tl_dev})}
    dev_acc = np.mean([predict(rt, e["state"], OPTIONS)[0] == e["label"] for e in dev])
    mnli_acc = np.mean([predict(rt, e["state"], OPTIONS)[0] == e["label"] for e in mnli_val])
    pred_counts = Counter(r["pred"] for r in items)
    return {"path": str(path.relative_to(ROOT)), "io": io, "fixtures": {"accuracy": acc, "orderFlips": flips,
            "confusion": {f"{a}->{b}": n for (a, b), n in sorted(conf.items())}, "predicted": dict(pred_counts), "items": items},
            "synthDevAcc": float(dev_acc), "mnliValAcc": float(mnli_acc), "taglishDevAcc": tl_acc, "taglishDevBySrc": tl_by_src,
            "nDev": len(dev), "nMnli": len(mnli_val), "nTaglishDev": len(tl_dev)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="ft1")
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--extra", nargs="*", default=[], help="label=path pairs of further int8 dirs")
    ap.add_argument("--int8", default=None, help="int8 dir of the fine-tuned model, relative to models/finetune (default <run>/onnx-int8)")
    ap.add_argument("--no-fixtures", action="store_true", help="dev sets only; the held-out fixtures are not read")
    ap.add_argument("--no-base", action="store_true", help="skip the shipped base model")
    ap.add_argument("--out", default=None, help="output json, relative to models/finetune (default <run>/eval.json)")
    args = ap.parse_args()

    fixtures = [] if args.no_fixtures else json.loads((ROOT / "fixtures" / "phase0.json").read_text())["items"]
    _, dev = synthetic_split(random.Random(args.seed))
    mnli_val = mnli("validation_matched", 67)
    tl_dev = taglish_dev(args.seed)
    models = {} if args.no_base else {"base (shipped int8)": ROOT / "models/decima-small/onnx/int8"}
    models["finetuned"] = ROOT / "models/finetune" / (args.int8 or f"{args.run}/onnx-int8")
    for kv in args.extra:
        k, v = kv.split("=", 1)
        models[k] = ROOT / v
    res = {name: eval_model(p, fixtures, dev, mnli_val, tl_dev) for name, p in models.items() if (p / "encoder.onnx").exists()}
    res["_meta"] = {"onnxruntime": ort.__version__, "seed": args.seed, "fixturesEvaluated": not args.no_fixtures}
    out = ROOT / "models/finetune" / (args.out or f"{args.run}/eval.json")
    out.write_text(json.dumps(res, indent=1, ensure_ascii=False))

    base_io = json.loads((ROOT / "models/finetune/ft1/eval.json").read_text())["base (shipped int8)"]["io"]
    print(f"{'model':<26} {'en/10':>5} {'tl/10':>5} {'flips':>5} {'synth-dev':>9} {'tl-dev':>7} {'mnli-val':>8}  predicted  io-match")
    for name, r in res.items():
        if name.startswith("_"):
            continue
        f = r["fixtures"]
        print(f"{name:<26} {f['accuracy']['en']:>5} {f['accuracy']['tl']:>5} {f['orderFlips']:>5} {r['synthDevAcc']:>9.3f} "
              f"{r['taglishDevAcc']:>7.3f} {r['mnliValAcc']:>8.3f}  {f['predicted']}  {json.loads(json.dumps(r['io'])) == base_io}  {r['taglishDevBySrc']}")
    for name in ("base (shipped int8)", "finetuned"):
        if name in res:
            print(f"\n{name} confusion (label->pred): {res[name]['fixtures']['confusion']}")
    print(f"\nwrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
