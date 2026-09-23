"""
The separate local model for `primary`: TF-IDF plus a linear classifier.

Routing mode, declared: **empirical threshold routing**. The score is the raw
decision value, and it is never described or consumed as calibrated confidence.
ECE is measured and reported for transparency and is not blocking, which is the
consequence of that explicit architecture decision rather than a waiver.

Threshold selection follows the corrected procedure, in this order:

  1. mode is empirical-threshold, so the applicable constraints are deployed-rule
     absolute quality, routing precision and coverage
  2. the selection pool is carved from training-side data only: the training split.
     Validation, calibration and test rows are never in it
  3. five-fold cross-fitting inside that pool, refitting the vectorizer and the
     classifier per fold, so no row is scored by a model fitted on it
  4. thresholds are searched over those out-of-fold raw scores
  5. among thresholds satisfying every applicable constraint, the highest coverage
     wins. Precision alone is not a selection objective, and a threshold that
     satisfies precision while failing deployed-rule quality is not eligible
  6. the chosen threshold is confirmed on the other half of the pool
  7. it is frozen, then validation is read exactly once
  8. the test split stays closed

    tools/models/.venv/bin/python tools/models/primary_local_model.py
"""

from __future__ import annotations

import json
import platform
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, f1_score, precision_score, recall_score
from sklearn.model_selection import StratifiedKFold

sys.path.insert(0, str(Path(__file__).resolve().parent))

from phase1_baselines import SEED, expected_calibration_error, labels_for, load_rows, load_splits  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"
MODEL_DIR = ARTIFACTS / "primary-local"

dataset_path = Path(sys.argv[sys.argv.index("--dataset") + 1]) if "--dataset" in sys.argv else ARTIFACTS / "relabel-corpus.jsonl"
splits_path = Path(sys.argv[sys.argv.index("--splits") + 1]) if "--splits" in sys.argv else ARTIFACTS / "contract1-splits.json"

# The declared architecture decision for this head, and the constraints it implies.
ROUTING_MODE = "empirical-threshold"
QUALITY_FLOOR = 0.80  # deployed-rule positive F1
PRECISION_FLOOR = 0.90  # routing precision
COVERAGE_FLOOR = 0.40  # routing coverage
ECE_GATE = 0.05  # reported, non-blocking under this mode
FOLDS = 5
MIN_ACCEPTED = 20  # below this a precision estimate is noise, not a measurement


def stats(true: list[str], pred: list[str]) -> dict:
    accepted = sum(1 for value in pred if value == "True")
    return {
        "f1": round(float(f1_score(true, pred, pos_label="True", zero_division=0)), 4),
        "precision": round(float(precision_score(true, pred, pos_label="True", zero_division=0)), 4),
        "recall": round(float(recall_score(true, pred, pos_label="True", zero_division=0)), 4),
        "accepted_local": int(accepted),
        "deferred": int(len(pred) - accepted),
        "coverage": round(accepted / max(len(pred), 1), 4),
    }


def fit(texts: list[str], labels: list[str]):
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=2)
    matrix = vectorizer.fit_transform(texts)
    counts = {value: labels.count(value) for value in set(labels)}
    imbalance = max(counts.values()) / min(counts.values())
    classifier = LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced" if imbalance >= 3 else None)
    classifier.fit(matrix, labels)
    return vectorizer, classifier


def main() -> None:
    rows = load_rows(dataset_path)
    splits = load_splits(splits_path)["splits"]

    def pairs(ids: list[str]):
        texts, labels = [], []
        for identifier in ids:
            value = (rows[identifier].get("labels") or {}).get("primary")
            if value is None:
                continue
            texts.append(rows[identifier]["input"])
            labels.append("True" if value is True or value == "True" else "False")
        return texts, labels

    # The selection pool is training-side only. Validation, calibration and test
    # are excluded by construction, not by convention.
    pool_texts, pool_labels = pairs([item for item in splits["train"] if item in rows])
    val_texts, val_labels = pairs([item for item in splits["validation"] if item in rows])

    # Cross-fitting inside the pool: raw decision scores, not probabilities.
    out_of_fold = np.zeros(len(pool_texts))
    folds = StratifiedKFold(n_splits=FOLDS, shuffle=True, random_state=SEED)
    for train_index, holdout_index in folds.split(pool_texts, pool_labels):
        vectorizer, classifier = fit(
            [pool_texts[i] for i in train_index], [pool_labels[i] for i in train_index]
        )
        out_of_fold[holdout_index] = classifier.decision_function(
            vectorizer.transform([pool_texts[i] for i in holdout_index])
        )

    rng = np.random.default_rng(SEED)
    order = rng.permutation(len(pool_texts))
    selection, measurement = order[: len(order) // 2], order[len(order) // 2 :]

    def search(indices) -> tuple[dict | None, list[dict]]:
        scores = out_of_fold[indices]
        truth = [pool_labels[i] for i in indices]
        lo, hi = float(np.percentile(scores, 1)), float(np.percentile(scores, 99))
        feasible: list[dict] = []
        for threshold in np.linspace(lo, hi, 120):
            predicted = ["True" if score >= threshold else "False" for score in scores]
            candidate = stats(truth, predicted)
            candidate["threshold"] = round(float(threshold), 4)
            if candidate["accepted_local"] < MIN_ACCEPTED:
                continue
            if (
                candidate["precision"] >= PRECISION_FLOOR
                and candidate["f1"] >= QUALITY_FLOOR
                and candidate["coverage"] >= COVERAGE_FLOOR
            ):
                feasible.append(candidate)
        if not feasible:
            return None, []
        # Highest coverage among the feasible thresholds, as the procedure requires.
        best = max(feasible, key=lambda row: (row["coverage"], -row["threshold"]))
        return best, feasible

    chosen, feasible = search(selection)
    if chosen is None:
        print("no threshold on the selection pool satisfies every applicable constraint")
        print("the head is not shippable under empirical routing and stays on the existing engine")
        raise SystemExit(1)

    held_out = stats(
        [pool_labels[i] for i in measurement],
        ["True" if out_of_fold[i] >= chosen["threshold"] else "False" for i in measurement],
    )

    # Refit on the whole pool, which is the artifact, then freeze and read validation once.
    vectorizer, classifier = fit(pool_texts, pool_labels)
    val_scores = classifier.decision_function(vectorizer.transform(val_texts))
    val_predicted = ["True" if score >= chosen["threshold"] else "False" for score in val_scores]
    validation = stats(val_labels, val_predicted)

    val_truth = np.array([value == "True" for value in val_labels])
    raw_probability = 1 / (1 + np.exp(-val_scores))
    ece_validation = expected_calibration_error(raw_probability, (raw_probability >= 0.5) == val_truth)
    brier_validation = float(brier_score_loss(val_truth.astype(int), raw_probability))

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIR / "primary-local.json"
    model_path.write_text(
        json.dumps(
            {
                "vectorizer": {
                    "vocabulary": vectorizer.vocabulary_,
                    "idf": [round(float(value), 6) for value in vectorizer.idf_],
                    "ngram_range": [1, 2],
                    "sublinear_tf": True,
                    "min_df": 2,
                },
                "classifier": {"coef": [float(v) for v in classifier.coef_[0]], "intercept": float(classifier.intercept_[0])},
                "routing": {"mode": ROUTING_MODE, "score": "decision_function", "threshold": chosen["threshold"]},
                "threshold_selection": "cross-fitted on the training-side pool, highest coverage subject to all applicable constraints",
            },
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )

    manifest = {
        "model_id": "pulse-primary-local",
        "version": "1.2.0",
        "model_type": "separate_tfidf_linear",
        "heads": {"primary": {"kind": "noul", "routing_mode": ROUTING_MODE, "score": "decision_function", "threshold": chosen["threshold"]}},
        "undeclared_heads": {head: "existing configured engine" for head in ("topic", "signal", "whyKey", "category", "field")},
        "runtime": "native vectorizer and linear inference; no ONNX Runtime, no tokenizer",
        "calibration": {"required_for_routing": False, "reason": "empirical threshold routing is the explicit architecture decision for this head"},
    }
    (MODEL_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    timing = []
    for _ in range(5):
        start = time.perf_counter()
        classifier.decision_function(vectorizer.transform(val_texts))
        timing.append((time.perf_counter() - start) * 1000 / max(len(val_texts), 1))
    timing.sort()

    gates = {
        "deployed_rule_quality": {"target": QUALITY_FLOOR, "value": validation["f1"], "pass": validation["f1"] >= QUALITY_FLOOR},
        "routing_precision": {"target": PRECISION_FLOOR, "value": validation["precision"], "pass": validation["precision"] >= PRECISION_FLOOR},
        "routing_coverage": {"target": COVERAGE_FLOOR, "value": validation["coverage"], "pass": validation["coverage"] >= COVERAGE_FLOOR},
        "calibration_ece": {
            "target": ECE_GATE,
            "value": round(ece_validation, 4),
            "blocking": False,
            "status": "informational under empirical threshold routing",
        },
    }
    shippable = all(row["pass"] for row in gates.values() if "pass" in row)

    report = {
        "ranAt": datetime.now().isoformat(timespec="seconds"),
        "candidate": "TF-IDF + logistic regression, primary head only",
        "routing_mode": {"declared": ROUTING_MODE, "probabilities_as_confidence": False},
        "test_split_read": False,
        "test_ids_locked": len(splits["test"]),
        "seed": SEED,
        "selection_pool": {
            "construction": "training split only",
            "rows": len(pool_texts),
            "excluded": {"validation": len(val_texts), "calibration": len(splits["calibration"]), "test": len(splits["test"])},
            "cross_fitting": f"{FOLDS}-fold, vectorizer and classifier refitted per fold, raw decision scores",
        },
        "threshold_selection": {
            "objective": "highest coverage among thresholds satisfying every applicable constraint",
            "constraints": {"quality": QUALITY_FLOOR, "precision": PRECISION_FLOOR, "coverage": COVERAGE_FLOOR},
            "feasible_thresholds_found": len(feasible),
            "chosen": chosen,
        },
        "held_out_confirmation": {"rows": len(measurement), **held_out},
        "validation_single_evaluation": {"rows": len(val_texts), **validation},
        "gates": gates,
        "shippable": bool(shippable),
        "artifact": {"path": str(model_path.relative_to(ROOT)), "bytes": model_path.stat().st_size, "onnx_runtime_bytes": 0},
        "latency": {
            "ms_per_item_p50": round(timing[len(timing) // 2], 4),
            "ms_per_item_p95": round(timing[-1], 4),
            "reference": f"{platform.system()} {platform.machine()}",
        },
    }

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "primary-local.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(f"mode {ROUTING_MODE}, selection pool {len(pool_texts)} training rows, {FOLDS}-fold cross-fitted")
    print(f"  feasible thresholds {len(feasible)}, chosen {chosen['threshold']} for highest coverage")
    print(f"  selection half:    {chosen}")
    print(f"  held-out half:     {held_out}")
    print(f"  validation once:   {validation}")
    print(f"  ECE {ece_validation:.4f} (informational, non-blocking under this mode), brier {brier_validation:.4f}")
    print(f"  shippable: {shippable}")
    print(f"  artifact {model_path.stat().st_size / 1e3:.1f}KB, latency {timing[len(timing)//2]:.4f}ms p50 per item")
    print(f"  test split locked: {len(splits['test'])} ids")
    print(f"wrote {RESULTS / 'primary-local.json'}")


if __name__ == "__main__":
    main()
