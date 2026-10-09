"""Q6 follow-up: does the question framing explain the low fixture accuracy? Runs the 20 fixtures under a few
renderings and prints accuracy per language. Same 20 items for every variant, so a winner here is a hypothesis to
confirm on fresh items, not a tuned result.

    uv run python prompt_variants.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from decima.runtime import DecimaOnnx
from decima.systemone import system_one

ROOT = Path(__file__).resolve().parent.parent
LABELS = ["supports", "contradicts", "unrelated"]

# name → (state template, question, criteria: list of option labels or {label: description}, option → fixture label)
VARIANTS = {
    "A prd": ("Claim: {claim}\nEvidence: {evidence}", "Does the evidence support the claim?",
              LABELS, None),
    "B evidence-first": ("Evidence: {evidence}\nClaim: {claim}", "Does the evidence support the claim?",
                         LABELS, None),
    "C nli-native": ("Premise: {evidence}\nHypothesis: {claim}", "Does the hypothesis follow from the premise?",
                     ["entailment", "neutral", "contradiction"],
                     {"entailment": "supports", "neutral": "unrelated", "contradiction": "contradicts"}),
    "D described": ("Claim: {claim}\nEvidence: {evidence}", "Does the evidence support the claim?",
                    {"supports": "The evidence shows the claim is true.",
                     "contradicts": "The evidence shows the claim is false.",
                     "unrelated": "The evidence does not say whether the claim is true or false."}, None),
    "E nli-described": ("Premise: {evidence}\nHypothesis: {claim}", "Does the hypothesis follow from the premise?",
                        {"supports": "The premise shows the hypothesis is true.",
                         "contradicts": "The premise shows the hypothesis is false.",
                         "unrelated": "The premise does not say whether the hypothesis is true or false."}, None),
}


def main() -> None:
    fx = json.loads((ROOT / "fixtures" / "phase0.json").read_text())
    rt = DecimaOnnx(ROOT / "models" / "decima-small" / "onnx" / "int8", threads=1)
    results = {}
    for name, (tmpl, question, criteria, to_label) in VARIANTS.items():
        rows = []
        for it in fx["items"]:
            state = tmpl.format(claim=it["claim"], evidence=it["evidence"])
            a = system_one(rt, state, {"v": {"type": "choice", "instructions": question, "criteria": criteria}})["v"]
            pred = to_label[a["choice"]] if to_label else a["choice"]
            rows.append({"id": it["id"], "lang": it["lang"], "label": it["label"], "pred": pred, "p": a["probabilities"]})
        acc = {lang: sum(r["pred"] == r["label"] for r in rows if r["lang"] == lang) for lang in ("en", "tl")}
        by_label = {lab: sum(r["pred"] == lab for r in rows) for lab in LABELS}
        results[name] = {"accuracy": acc, "predicted": by_label, "rows": rows}
        print(f"{name:<18} en {acc['en']}/10  tl {acc['tl']}/10   predicted {by_label}")
    out = ROOT / "fixtures" / "phase0.prompt-variants.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    np.set_printoptions(precision=3)
    main()
