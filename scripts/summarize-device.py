"""Summarise results/device/run-<threads>.log (PHASE0_RESULT lines from the debug screen) into the PRD's results table.

    python3 scripts/summarize-device.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEV = ROOT / "results" / "device"


def parse(path: Path) -> dict:
    out: dict = {"fixture": []}
    for line in path.read_text().splitlines():
        tag, _, payload = line.partition(" ")
        try:
            val = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if tag == "fixture":
            out["fixture"].append(val)
        else:
            out.setdefault(tag, val)
    return out


def pss_samples(t: str) -> list[float]:
    f = DEV / f"meminfo-{t}.log"
    if not f.exists():
        return []
    return [int(m) / 1024 for m in re.findall(r"TOTAL PSS:\s+(\d+)", f.read_text())]


def main() -> None:
    runs = {p.stem.split("-")[1]: parse(p) for p in sorted(DEV.glob("run-*.log"))}
    if not runs:
        raise SystemExit("no results/device/run-*.log yet")
    dev = next(iter(runs.values())).get("device", {})
    print(f"Device: {dev}\n")
    print("| Threads | Cold load ms (read / parse / tokenizer / encoder / scorer [/ wait]) | First ms | Median ms | p95 ms | "
          "Peak RSS MB (VmHWM, bench) | Max PSS MB (in-app / dumpsys) |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for t, r in sorted(runs.items(), key=lambda kv: int(kv[0])):
        lt, b = r.get("load", {}).get("timings", {}), r.get("bench", {})
        if not lt or not b:
            print(f"| {t} | incomplete: {sorted(r)} |")
            continue
        parts = " / ".join(f"{lt.get(k, float('nan')):.0f}" for k in ("readFilesMs", "tokenizerParseMs", "tokenizerMs", "encoderMs", "scorerMs"))
        if "sessionWaitMs" in lt:  # logs from before sessionWaitMs existed omit it
            parts += f" / wait {lt['sessionWaitMs']:.0f}"
        mem = b["memory"]
        ds = pss_samples(t)
        print(f"| {t} | {lt['totalMs']:.0f} ({parts}) | {b['firstMs']:.0f} | {b['medianMs']:.1f} | {b['p95Ms']:.1f} | "
              f"{mem['after']['peakRssMb']:.0f} | {mem['maxPssMb']:.0f} / {max(ds) if ds else float('nan'):.0f} |")

    print()
    for t, r in sorted(runs.items(), key=lambda kv: int(kv[0])):
        f = r.get("fixtures")
        if not f:
            continue
        acc = " · ".join(f"{k} {v['correct']}/{v['total']}" for k, v in f["accuracy"].items())
        print(f"{t}T fixtures: tokenizer mismatches {f['tokenizerMismatches']} (+{f['edgeCaseMismatches']} edge) · "
              f"max Δp {f['maxDelta']:.4f} · order flips {f['orderFlips']} · {acc} · {len(r['fixture'])} item lines")
    errors = [r["error"] for r in runs.values() if "error" in r]
    if errors:
        print("\nERRORS:", errors)


if __name__ == "__main__":
    main()
