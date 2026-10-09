"""Phase 0 reference harness: runs upstream Decima (ONNX int8, CPU, 1 thread) over fixtures/phase0.json and
writes every intermediate the TypeScript engine must reproduce to fixtures/phase0.reference.json.

    uv run python export_reference.py [--model ../models/decima-small/onnx/int8]

Per fixture and per option order: rendered state/choice texts, token ids + masks, encoder output probes,
raw scorer scores, final probabilities, argmax. Plus tokenizer edge cases, System One answers, accuracy
per language, and a 50-run laptop latency baseline.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import statistics
import time
from importlib.metadata import version
from pathlib import Path

import numpy as np
from decima.runtime import DecimaOnnx
from decima.systemone import system_one
from decima.render import choice_texts
from decima.types import Question

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures" / "phase0.json"
OUT = ROOT / "fixtures" / "phase0.reference.json"

# The three option orders every fixture is run with (indices into the canonical option list).
ORDERS = {"canonical": [0, 1, 2], "reversed": [2, 1, 0], "rotated": [1, 2, 0]}

# Strings that stress the tokenizer beyond the fixtures: accents, ñ, curly quotes, emoji, CJK, numbers,
# whitespace runs, and over-long inputs that must be truncated at the state (512) / choice (64) windows.
TOKENIZER_EDGE_CASES = [
    "",
    "   leading and trailing   ",
    "Señor Niño ñ Ñ — “quoted” ‘single’ … ellipsis",
    "Grabe!!! 😡😡 fake news daw?? #NoToFakeNews @user https://example.com/a?b=1",
    "₱1,500.00 noong 2024-06-12, 3:45 PM — 50% off",
    "Hindi totoo na nag-resign si Pangulong Marcos — ayon sa PCO.",
    "café naïve résumé Ångström ﬁ ligature ① ½ ²",
    "日本語のテキスト 한국어 текст",
    "tab\tseparated\nnew line\r\nwindows",
    "query: " + "Ang balitang ito ay kumakalat sa social media. " * 120,
    "passage: Does the evidence support the claim? " + "word " * 100,
]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _nums(x) -> list[float]:
    """Every number in a System One answer, in key order."""
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        return [float(x)]
    if isinstance(x, dict):
        return [n for v in x.values() for n in _nums(v)]
    return []


def tok_ids(rt: DecimaOnnx, text: str, max_len: int) -> list[int]:
    return [int(x) for x in rt.tok(text, truncation=True, max_length=max_len)["input_ids"]]


def run_one(rt: DecimaOnnx, state: str, question: str, options: list[str]) -> dict:
    """One Choice decision with every intermediate exposed (mirrors DecimaOnnx.decide_logits + probs)."""
    q = Question(question, options, kind="choose")
    cfg = rt.cfg
    state_text = rt._state(state, q)
    _, qt = rt._choice_key(q)
    choice_texts = rt._choice_texts(q, qt)

    ch, cm = rt.encode(choice_texts, cfg["max_choice_tokens"])
    h, m = rt.encode([state_text], cfg["max_state_tokens"])
    s, z = rt.sc.run(None, {"state_h": h, "state_mask": m, "choice_h": ch, "choice_mask": cm})
    logp = rt.decide_logits(state, q)  # the library path, for a self-check against the manual one
    p = np.exp(logp - logp.max()) / np.exp(logp - logp.max()).sum()

    manual = s / cfg["temperature"]
    manual = np.exp(manual - manual.max()) / np.exp(manual - manual.max()).sum()
    assert np.allclose(manual, p, atol=1e-6), (manual, p)

    return {
        "options": options,
        "stateText": state_text,
        "choiceTexts": choice_texts,
        "stateIds": tok_ids(rt, state_text, cfg["max_state_tokens"]),
        "choiceIds": [tok_ids(rt, t, cfg["max_choice_tokens"]) for t in choice_texts],
        "choiceMask": cm.tolist(),
        # encoder probes: enough to localise an encoder mismatch without shipping whole tensors
        "stateHProbe": {"shape": list(h.shape), "sum": float(h.sum()), "first8": h[0, 0, :8].tolist(), "last8": h[0, -1, -8:].tolist()},
        "choiceHProbe": {"shape": list(ch.shape), "sum": float(ch.sum()), "first8": ch[0, 0, :8].tolist()},
        "scores": s.tolist(),
        "probs": p.tolist(),
        "answer": options[int(np.argmax(p))],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "models" / "decima-small" / "onnx" / "int8"))
    args = ap.parse_args()
    model = Path(args.model)

    fx = json.loads(FIXTURES.read_text())
    question, options = fx["question"], fx["options"]
    rt = DecimaOnnx(model, threads=1)

    items = []
    for it in fx["items"]:
        state = f"Claim: {it['claim']}\nEvidence: {it['evidence']}"
        runs = {name: run_one(rt, state, question, [options[i] for i in order]) for name, order in ORDERS.items()}
        answers = {r["answer"] for r in runs.values()}
        so = system_one(rt, state, {"verdict": {"type": "choice", "instructions": question, "criteria": options}})
        items.append({
            "id": it["id"], "lang": it["lang"], "label": it["label"], "state": state,
            "runs": runs,
            "orderInvariant": len(answers) == 1,
            "correct": runs["canonical"]["answer"] == it["label"],
            "systemOne": so,
        })
        print(f"{it['id']:>8} {it['lang']}  label={it['label']:<12} pred={runs['canonical']['answer']:<12} "
              f"p={np.round(runs['canonical']['probs'], 3).tolist()}  invariant={len(answers) == 1}")

    # smoke references for the other two System One kinds (non-goal beyond a smoke test, but the interface has them)
    multi_kind = {
        "verdict": {"type": "choice", "instructions": question, "criteria": options},
        "credible": {"type": "noul", "instructions": "The evidence shows the claim is true."},
        "strength": {"type": "score", "instructions": "How strongly does the evidence back the claim?",
                     "criteria": ["not at all", "somewhat", "strongly"]},
    }
    # "answers": one system_one call per question (the unbatched decide() path the engine mirrors);
    # "batchedAnswers": one call for all three, which goes through decide_many's padded batch. With this int8 model
    # padding shifts the encoder output slightly, so the two differ by a few 1e-3 (recorded, within SP-05's 0.02).
    system_one_smoke = []
    for it in items[:3]:
        single = {qid: system_one(rt, it["state"], {qid: spec})[qid] for qid, spec in multi_kind.items()}
        batched = system_one(rt, it["state"], multi_kind)
        drift = max(abs(a - b) for qid in multi_kind for a, b in zip(_nums(single[qid]), _nums(batched[qid])))
        system_one_smoke.append({"id": it["id"], "state": it["state"], "questions": multi_kind,
                                 "answers": single, "batchedAnswers": batched, "batchDrift": drift})
    print("system_one batched-vs-single drift:", [round(s["batchDrift"], 4) for s in system_one_smoke])

    cfg = rt.cfg
    # render.choice_texts fallbacks: a question long enough that the right-hand cut merges options (→ fitted
    # rendering), and long options that are cut but stay distinct (→ legacy rendering kept)
    render_cases = []
    for rq, rc in [("word " * 80 + "?", ["yes", "no"]),
                   ("Is this claim, which has been widely shared on Facebook and TikTok by many pages, true?",
                    ["it is true according to official government sources", "it is false and was made up"]),
                   (question, ["supports", "contradicts", "unrelated"])]:
        render_cases.append({"question": rq, "choices": rc,
                             "out": choice_texts(rt.tok, rq, rc, "en", cfg["choice_prefix"], cfg["max_choice_tokens"],
                                                 fit=cfg.get("choice_fit", False))})
    edge = [{"text": t, "maxLen": ml, "ids": tok_ids(rt, t, ml)}
            for t in TOKENIZER_EDGE_CASES for ml in (cfg["max_state_tokens"], cfg["max_choice_tokens"])]

    accuracy = {}
    for lang in sorted({i["lang"] for i in items}):
        sub = [i for i in items if i["lang"] == lang]
        accuracy[lang] = {"correct": sum(i["correct"] for i in sub), "total": len(sub)}

    # laptop latency baseline: 1 thread, warm, one fixture, choice encodings cached (as on device)
    state0 = items[0]["state"]
    q0 = Question(question, options)
    rt.decide(state0, q0)
    ts = []
    for _ in range(50):
        t0 = time.perf_counter()
        rt.decide(state0, q0)
        ts.append((time.perf_counter() - t0) * 1e3)
    ts.sort()

    out = {
        "generatedBy": "harness/export_reference.py",
        "env": {
            "python": platform.python_version(), "machine": platform.machine(), "platform": platform.platform(),
            "decima-ai": version("decima-ai"), "onnxruntime": version("onnxruntime"),
            "transformers": version("transformers"), "numpy": version("numpy"),
        },
        "model": {
            "dir": str(model.relative_to(ROOT)) if model.is_relative_to(ROOT) else str(model),
            "sha256": {f.name: sha256(f) for f in sorted(model.glob("*.onnx"))},
            "config": {k: cfg[k] for k in ("temperature", "max_state_tokens", "max_choice_tokens", "state_prefix",
                                            "choice_prefix", "question_in_state", "question_in_choices")},
            "choiceFit": cfg.get("choice_fit", False),
            "padTokenId": rt.tok.pad_token_id,
        },
        "question": question,
        "options": options,
        "orders": ORDERS,
        "items": items,
        "tokenizerEdgeCases": edge,
        "systemOneSmoke": system_one_smoke,
        "renderCases": render_cases,
        "accuracy": accuracy,
        "orderFlips": sum(not i["orderInvariant"] for i in items),
        "laptopLatencyMs": {"median": statistics.median(ts), "p95": ts[int(0.95 * len(ts)) - 1], "n": len(ts)},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"\naccuracy {accuracy}  orderFlips={out['orderFlips']}  laptop median/p95 ms "
          f"{out['laptopLatencyMs']['median']:.1f}/{out['laptopLatencyMs']['p95']:.1f}\nwrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
