"""
Scores the heuristic baseline for category and field on the contract-v1 split.

The heuristic is the applicable baseline for these two heads and produces no
prediction for the other four, which are judged against the prior alone. It is
scored with the same metrics, the same bootstrap procedure and the same seed as
every other candidate, so the comparison is like for like.

    tools/models/.venv/bin/python tools/models/score_heuristic.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from sklearn.metrics import accuracy_score, f1_score

sys.path.insert(0, str(Path(__file__).resolve().parent))

from phase1_baselines import SEED, bootstrap_ci  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"

CORPUS = ARTIFACTS / "relabel-corpus.jsonl"
PREDICTIONS = ARTIFACTS / "heuristic-contract1.jsonl"
SPLITS = ARTIFACTS / "contract1-splits.json"

# Only heads the heuristic actually predicts. For the rest there is no baseline
# to compare against, and none is invented.
HEADS = {"category": "category", "field": "field"}


def main() -> None:
    if not PREDICTIONS.exists():
        raise SystemExit(f"No predictions at {PREDICTIONS}. Run: npx tsx scripts/models/heuristic-baseline.ts")

    rows = {json.loads(line)["id"]: json.loads(line) for line in CORPUS.read_text(encoding="utf-8").splitlines() if line.strip()}
    predictions = {
        json.loads(line)["id"]: json.loads(line)
        for line in PREDICTIONS.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    validation = json.loads(SPLITS.read_text(encoding="utf-8"))["splits"]["validation"]

    report = {
        "candidate": "heuristicClassify (the app's own deterministic rules)",
        "evaluated_on": "validation of the contract-v1 split",
        "evaluated": len(validation),
        "seed": SEED,
        "applies_to": sorted(HEADS),
        "not_applicable": "topic, signal, primary, whyKey: the heuristic produces no prediction",
        "heads": {},
    }

    print(f"heuristic baseline on {len(validation)} validation items")
    for head, key in HEADS.items():
        pairs = [
            (str(rows[i]["labels"][key]), str(predictions[i][key]))
            for i in validation
            if i in rows and i in predictions and rows[i]["labels"].get(key) is not None
        ]
        if len(pairs) < 10:
            report["heads"][head] = {"skipped": "too few labelled rows"}
            continue
        true = [t for t, _ in pairs]
        pred = [p for _, p in pairs]
        point = f1_score(true, pred, average="macro", zero_division=0)
        low, high = bootstrap_ci(true, pred, lambda a, b: f1_score(a, b, average="macro", zero_division=0))
        report["heads"][head] = {
            "primary_metric": "macro_f1",
            "point": round(float(point), 4),
            "ci95": [round(low, 4), round(high, 4)],
            "accuracy": round(float(accuracy_score(true, pred)), 4),
        }
        print(f"  {head:<9} macro_f1 {point:.4f}  ci95 [{low:.4f}, {high:.4f}]")

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "heuristic-baseline.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {RESULTS / 'heuristic-baseline.json'}")


if __name__ == "__main__":
    main()
