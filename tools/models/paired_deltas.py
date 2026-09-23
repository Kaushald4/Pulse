"""
Paired validation deltas between the fine-tuned candidates and the baselines.

Two overlapping confidence intervals say nothing about which candidate is better,
because both are computed on the same 200 validation items. This compares them
pairwise on those items and bootstraps the *difference*, which is the statistic
the question actually needs: is the fine-tuned model ahead of TF-IDF and of the
frozen encoders, and by how much, with the uncertainty of that difference.

Sign convention: positive always means the fine-tuned candidate is better, so a
lower-is-better metric like MAE is negated before differencing.

    tools/models/.venv/bin/python tools/models/paired_deltas.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import f1_score, mean_absolute_error

sys.path.insert(0, str(Path(__file__).resolve().parent))

from phase1_baselines import SEED  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "tools" / "models" / "results"
BOOTSTRAP = 2000

METRIC = {"signal": "mae", "primary": "positive_f1"}
HEADS = ["topic", "signal", "primary", "whyKey"]


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def score(metric: str, true: list, pred: list) -> float:
    if metric == "mae":
        return -float(mean_absolute_error(true, pred))
    if metric == "positive_f1":
        # Labels are stringified above, so the positive class is the string.
        return float(f1_score(true, pred, pos_label="True", zero_division=0))
    return float(f1_score(true, pred, average="macro", zero_division=0))


def paired(head: str, true: list, reference: list, candidate: list) -> dict:
    metric = METRIC.get(head, "macro_f1")
    base = score(metric, true, reference)
    cand = score(metric, true, candidate)
    rng = np.random.default_rng(SEED)
    deltas = []
    for _ in range(BOOTSTRAP):
        index = rng.integers(0, len(true), len(true))
        t = [true[i] for i in index]
        deltas.append(score(metric, t, [candidate[i] for i in index]) - score(metric, t, [reference[i] for i in index]))
    deltas = np.array(deltas)
    return {
        "metric": metric,
        "reference_point": round(base, 4),
        "candidate_point": round(cand, 4),
        "delta": round(cand - base, 4),
        "delta_ci95": [round(float(np.percentile(deltas, 2.5)), 4), round(float(np.percentile(deltas, 97.5)), 4)],
        "probability_candidate_better": round(float((deltas > 0).mean()), 4),
    }


def main() -> None:
    tag = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else "escalated"
    tfidf = read(RESULTS / "baseline-results-contract1.json")["heads"]
    frozen = read(RESULTS / "encoder-results-contract1.json")["models"]
    finetuned = read(RESULTS / f"finetune-contract1-{tag}.json")["models"]

    # Ground truth comes from the contract-v1 corpus, so every comparison uses
    # identical labels regardless of which candidate produced the predictions.
    label_key = {"category": "category", "field": "field", "topic": "topic", "signal": "signalLevel", "primary": "primary", "whyKey": "whyKey"}
    truth: dict[str, dict[str, str]] = {}
    corpus = (ROOT / "tools" / "models" / "artifacts" / "relabel-corpus.jsonl").read_text(encoding="utf-8")
    for line in corpus.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        for head, key in label_key.items():
            value = (row.get("labels") or {}).get(key)
            if value is not None:
                truth.setdefault(head, {})[row["id"]] = str(value)

    references: dict[str, dict] = {}
    for model, entry in frozen.items():
        references[f"frozen-{model}"] = entry["heads"]
    references["tfidf"] = tfidf

    report = {"note": "positive delta means the fine-tuned candidate is better", "heads": {}, "convergence": {}}
    for model, entry in finetuned.items():
        report["convergence"][model] = entry["convergence"]
        for head in HEADS:
            stats = entry["validation"].get(head, {})
            if "predictions" not in stats or "eval_ids" not in stats:
                continue
            candidate = stats["predictions"]
            ids = stats["eval_ids"]

            for name, source in references.items():
                ref = source.get(head, {})
                if "predictions" not in ref or "eval_ids" not in ref:
                    continue
                lookup = dict(zip(ref["eval_ids"], ref["predictions"]))
                paired_ids = [i for i in ids if i in lookup and i in truth.get(head, {})]
                if len(paired_ids) < 20:
                    continue

                true = [truth[head][i] for i in paired_ids]
                if head == "signal":
                    # Levels are ordinal integers, not class ids.
                    true = [str(int(float(value))) for value in true]
                cand = [str(candidate[ids.index(i)]) for i in paired_ids]
                refpred = [str(lookup[i]) for i in paired_ids]
                if head == "signal":
                    cand = [str(int(float(value))) for value in cand]
                    refpred = [str(int(float(value))) for value in refpred]

                report["heads"].setdefault(head, {}).setdefault(model, {})[name] = paired(head, true, refpred, cand)

    (RESULTS / "paired-deltas-contract1-escalated.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print("convergence:")
    for model, stats in report["convergence"].items():
        print(f"  {model:<20} converged={stats['converged']} tail={stats['improvement']}")
    print()
    print(f"{'head':<9}{'candidate':<19}{'vs':<22}{'delta':>9}  ci95")
    for head, by_model in report["heads"].items():
        for model, by_reference in by_model.items():
            for name, stats in by_reference.items():
                print(
                    f"{head:<9}{model:<19}{name:<22}{stats['delta']:>9}  {stats['delta_ci95']}"
                    f"  P(better)={stats['probability_candidate_better']}"
                )
    print(f"\nwrote {RESULTS / 'paired-deltas-contract1-escalated.json'}")


if __name__ == "__main__":
    main()
