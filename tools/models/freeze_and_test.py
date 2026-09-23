"""
Freeze the production configuration, then read the locked test split exactly once.

The configuration is frozen as it stands: empirical threshold routing, threshold
-0.0346, the coverage-maximising objective, the held-out precision of 0.8842
recorded as a known caution, and ECE non-blocking because no probability is
consumed as confidence. Nothing is reselected, retrained, recalibrated or
optimised, and nothing is changed after the test is read.

Scoring is done natively from the frozen artifact, vocabulary, IDF values,
coefficients and intercept, rather than by refitting, so the numbers describe the
artifact that would ship. Before the test rows are touched, that native scorer is
checked against a sklearn reference on the training rows, which is where a
vectorizer ordering or IDF mismatch would show up.

    tools/models/.venv/bin/python tools/models/freeze_and_test.py
"""

from __future__ import annotations

import hashlib
import json
import math
import platform
import re
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, f1_score, precision_score, recall_score

sys.path.insert(0, str(Path(__file__).resolve().parent))

from phase1_baselines import SEED, expected_calibration_error, labels_for, load_rows, load_splits  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"
MODEL = ARTIFACTS / "primary-local" / "primary-local.json"
MANIFEST = ARTIFACTS / "primary-local" / "manifest.json"
DATASET = ARTIFACTS / "relabel-corpus.jsonl"
SPLITS = ARTIFACTS / "contract1-splits.json"

PARITY_TOLERANCE = 1e-6
TOKEN = re.compile(r"\b\w\w+\b", re.UNICODE)


def tokenize(text: str) -> list[str]:
    """The same tokenisation the vectorizer was fitted with: lowercase, 2+ word chars."""
    return TOKEN.findall(text.lower())


def grams(text: str, ngram_max: int = 2) -> list[str]:
    tokens = tokenize(text)
    out = list(tokens)
    for size in range(2, ngram_max + 1):
        out.extend(" ".join(tokens[i : i + size]) for i in range(len(tokens) - size + 1))
    return out


def native_scores(artifact: dict, texts: list[str]) -> np.ndarray:
    """Sublinear TF, IDF, L2 normalisation, then a linear score. No sklearn."""
    vocabulary = artifact["vectorizer"]["vocabulary"]
    idf = artifact["vectorizer"]["idf"]
    coef = artifact["classifier"]["coef"]
    intercept = artifact["classifier"]["intercept"]

    scores = np.zeros(len(texts))
    for row, text in enumerate(texts):
        counts = Counter(gram for gram in grams(text) if gram in vocabulary)
        if not counts:
            scores[row] = intercept
            continue
        indices, values = [], []
        for gram, count in counts.items():
            index = vocabulary[gram]
            indices.append(index)
            values.append((1 + math.log(count)) * idf[index] if artifact["vectorizer"]["sublinear_tf"] else count * idf[index])
        norm = math.sqrt(sum(value * value for value in values))
        if norm:
            values = [value / norm for value in values]
        scores[row] = intercept + sum(coef[index] * value for index, value in zip(indices, values))
    return scores


def stats(true: list[str], pred: list[str]) -> dict:
    accepted = sum(1 for value in pred if value == "True")
    return {
        "f1": round(float(f1_score(true, pred, pos_label="True", zero_division=0)), 4),
        "precision": round(float(precision_score(true, pred, pos_label="True", zero_division=0)), 4),
        "recall": round(float(recall_score(true, pred, pos_label="True", zero_division=0)), 4),
        "accepted_local": accepted,
        "deferred": len(pred) - accepted,
        "coverage": round(accepted / max(len(pred), 1), 4),
    }


def main() -> None:
    artifact = json.loads(MODEL.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    threshold = artifact["routing"]["threshold"]
    digest = hashlib.sha256(MODEL.read_bytes()).hexdigest()

    rows = load_rows(DATASET)
    splits = load_splits(SPLITS)["splits"]

    def pairs(ids: list[str]):
        texts, labels = [], []
        for identifier in ids:
            value = (rows[identifier].get("labels") or {}).get("primary")
            if value is None:
                continue
            texts.append(rows[identifier]["input"])
            labels.append("True" if value is True or value == "True" else "False")
        return texts, labels

    # Parity first: the native scorer must reproduce the fitted model exactly.
    train_texts, train_labels = pairs([i for i in splits["train"] if i in rows])
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=2)
    matrix = vectorizer.fit_transform(train_texts)
    counts = {value: train_labels.count(value) for value in set(train_labels)}
    reference = LogisticRegression(
        max_iter=2000, C=4.0, class_weight="balanced" if max(counts.values()) / min(counts.values()) >= 3 else None
    )
    reference.fit(matrix, train_labels)
    reference_scores = reference.decision_function(matrix)
    native_train = native_scores(artifact, train_texts)
    max_diff = float(np.abs(native_train - reference_scores).max())
    print(f"native scorer parity on {len(train_texts)} training rows: max abs difference {max_diff:.3e}")
    if max_diff > PARITY_TOLERANCE:
        raise SystemExit(f"native scorer disagrees with the fitted model by {max_diff}; refusing to score the test split")

    freeze = {
        "frozenAt": datetime.now().isoformat(timespec="seconds"),
        "status": "frozen",
        "accepted_as_is": [
            "empirical threshold routing, the recorded per-head architecture decision",
            f"threshold {threshold} selected by the coverage-maximising objective",
            "held-out precision 0.8842 recorded as a known variability point",
            "ECE non-blocking because probabilities are not consumed as confidence",
        ],
        "not_rerun": ["selection", "training", "calibration", "threshold optimisation"],
        "artifact": {"path": str(MODEL.relative_to(ROOT)), "sha256": digest, "bytes": MODEL.stat().st_size},
        "manifest": manifest,
        "routing_mode": artifact["routing"]["mode"],
        "threshold": threshold,
        "test_split": {"locked": True, "ids": len(splits["test"])},
    }
    (RESULTS / "production-config-frozen.json").write_text(json.dumps(freeze, indent=2) + "\n", encoding="utf-8")
    print(f"frozen configuration recorded, artifact sha256 {digest[:16]}")

    # The single test evaluation.
    test_texts, test_labels = pairs([i for i in splits["test"] if i in rows])
    test_scores = native_scores(artifact, test_texts)
    predicted = ["True" if score >= threshold else "False" for score in test_scores]
    test_stats = stats(test_labels, predicted)

    truth = np.array([value == "True" for value in test_labels])
    probability = 1 / (1 + np.exp(-test_scores))
    ece = expected_calibration_error(probability, (probability >= 0.5) == truth)
    brier = float(brier_score_loss(truth.astype(int), probability))

    timing = []
    for _ in range(5):
        start = time.perf_counter()
        native_scores(artifact, test_texts)
        timing.append((time.perf_counter() - start) * 1000 / max(len(test_texts), 1))
    timing.sort()

    gates = {
        "deployed_rule_quality_0_80": {"value": test_stats["f1"], "pass": test_stats["f1"] >= 0.80},
        "routing_precision_0_90": {"value": test_stats["precision"], "pass": test_stats["precision"] >= 0.90},
        "routing_coverage_0_40": {"value": test_stats["coverage"], "pass": test_stats["coverage"] >= 0.40},
        "calibration_ece_0_05": {"value": round(ece, 4), "blocking": False, "status": "informational under empirical routing"},
    }
    shipping = all(row["pass"] for row in gates.values() if "pass" in row)

    report = {
        "ranAt": datetime.now().isoformat(timespec="seconds"),
        "phase": "final test evaluation, read once",
        "candidate": "TF-IDF + logistic regression, primary head only, family B",
        "configuration": {"frozen": True, "artifact_sha256": digest, "routing_mode": artifact["routing"]["mode"], "threshold": threshold},
        "test_split": {"items": len(test_texts), "read": True, "note": "read once after freezing; the configuration was not modified afterwards"},
        "parity_before_test": {"rows": len(train_texts), "max_abs_difference": max_diff, "tolerance": PARITY_TOLERANCE},
        "test": test_stats,
        "calibration": {"ece": round(ece, 4), "brier": round(brier, 4), "blocking": False},
        "gates": gates,
        "shipping_decision": "ship locally for the primary head" if shipping else "do not ship: keep primary on the existing engine",
        "configuration_modified_after_test": False,
        "latency": {"ms_per_item_p50": round(timing[len(timing) // 2], 4), "ms_per_item_p95": round(timing[-1], 4), "reference": f"{platform.system()} {platform.machine()}"},
        "seed": SEED,
    }
    (RESULTS / "final-test-results.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(f"\ntest split read once: {len(test_texts)} items")
    print(f"  deployed rule: f1 {test_stats['f1']}, precision {test_stats['precision']}, recall {test_stats['recall']}")
    print(f"  coverage {test_stats['coverage']} ({test_stats['accepted_local']} accepted, {test_stats['deferred']} deferred)")
    print(f"  ECE {ece:.4f} (informational, non-blocking), brier {brier:.4f}")
    for name, gate in gates.items():
        if "pass" in gate:
            print(f"  {name}: {gate['value']} -> {'pass' if gate['pass'] else 'FAIL'}")
    print(f"\nshipping decision: {report['shipping_decision']}")
    print(f"wrote {RESULTS / 'final-test-results.json'}")


if __name__ == "__main__":
    main()
