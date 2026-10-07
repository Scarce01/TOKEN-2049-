"""Bitget 2026-09-24: the CUSUM spike rule (Shewhart) on the same data as analysis/bitget_cusum.ts.

The rule (workflows/patrol/src/logic/cusum.ts): one minute whose outflow is above spikeMax raises the alarm at once.
spikeMax = m x p99 per active minute of Bitget 6's own 4-week baseline (2026-08-24 to 09-21, public on-chain).
False alarms are counted on 2026-09-21 00:00 to 09-24 18:31 (before the test transfer): only 3.8 days.
Usage: python3 analysis/bitget_spike.py   (writes analysis/out/bitget_spike.json)
"""

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
base = json.loads((ROOT / "datasets/public/bitget6_baseline_2026-08-24_09-20.json").read_text())
raw = json.loads((ROOT / "datasets/public/bitget6_series_2026-09-21_24.bq.json").read_text())
TEST = 3 * 1440 + 18 * 60 + 31  # minutes after 2026-09-21 00:00 UTC
BIG = 3 * 1440 + 18 * 60 + 58
DETECTED = 3 * 1440 + 19 * 60 + 5
UNIT = {"stable": 10**6, "eth": 10**18}


def series(kind):
    row = next(r for r in raw["rows"] if r["f"][0]["v"] == kind)
    # values are floor(log2(units) x 1000) of the minute's outflow; back to units (rounding error < 0.07%)
    return {int(o): 2 ** (int(l) / 1000) for o, l in (p.split(":") for p in row["f"][2]["v"].split(","))}


def hhmm(o):
    return f"09-{21 + o // 1440:02d} {o % 1440 // 60:02d}:{o % 60:02d}"


out = {"source": "public_onchain (baseline p99) + test of a new rule", "events_utc": {"test_transfer": hhmm(TEST), "large_outflow": hhmm(BIG), "bitget_detected": hhmm(DETECTED)}, "results": []}
for kind in ("stable", "eth"):
    xs = series(kind)
    p99 = int(base[kind]["p99_units_per_active_minute"])
    pre_days = TEST / 1440
    for m in (3, 5, 10, 20):
        cap = m * p99
        fp = sum(1 for o, v in xs.items() if o < TEST and v > cap)
        hit = min((o for o, v in xs.items() if o >= TEST and v > cap), default=None)
        out["results"].append({
            "kind": kind,
            "spike_max_x_p99": m,
            "spike_max_units": str(cap),
            "false_alarms_before_test_transfer": fp,
            "false_alarms_per_day": round(fp / pre_days, 2),
            "first_alarm": hhmm(hit) if hit is not None else None,
            "minutes_after_large_outflow": hit - BIG if hit is not None else None,
            "before_bitget_detected": hit is not None and hit < DETECTED,
        })
(ROOT / "analysis/out").mkdir(exist_ok=True)
(ROOT / "analysis/out/bitget_spike.json").write_text(json.dumps(out, indent=2) + "\n")
for r in out["results"]:
    print(r["kind"], f"{r['spike_max_x_p99']}x p99:", f"FP/day {r['false_alarms_per_day']},", f"first alarm {r['first_alarm']} ({r['minutes_after_large_outflow']} min after 18:58)")
