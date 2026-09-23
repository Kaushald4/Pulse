"""
Phase 1 candidate benchmark.

Answers one question: given the labels we have, how much learnable signal exists
per head? It does *not* establish that the stored labels are Pulse's canonical
classification contract. Phase 0 showed the stored labels were written under an
earlier prompt or model definition, so every result file names the label target
it was fitted against and says the prompt version is unknown for historical rows.

Candidates: the majority prior, and TF-IDF with logistic regression over the
canonical input text. Encoder candidates are added once their runtime is
available; the harness is written so they slot in beside these.

Discipline, enforced rather than documented: metrics are computed on validation,
and the test split is refused unless --final is passed. Candidate comparison
never reads the test split.

    tools/models/.venv/bin/python tools/models/phase1_baselines.py
    tools/models/.venv/bin/python tools/models/phase1_baselines.py --final
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    cohen_kappa_score,
    f1_score,
    mean_absolute_error,
)

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"

DATASET = ARTIFACTS / "dataset.jsonl"
SPLITS = ARTIFACTS / "splits.json"
META = ARTIFACTS / "dataset.meta.json"

BOOTSTRAP = 1000
SEED = 20260922

# The four heads Phase 0 found to carry signal above a constant predictor.
# category and field are still scored, so a failure is visible rather than
# asserted, but they are not promoted by this run.
HEADS = ["category", "field", "topic", "signal", "primary", "whyKey"]
PROMOTED = ["topic", "signal", "primary", "whyKey"]
LABEL_KEYS = {
    "category": "category",
    "field": "field",
    "topic": "topic",
    "signal": "signalLevel",
    "primary": "primary",
    "whyKey": "whyKey",
}
ORDINAL = {"signal"}


def load_rows(path: Path = DATASET) -> dict[str, dict]:
    if not path.exists():
        raise SystemExit(f"No dataset at {path}. Run: npx tsx scripts/models/export-dataset.ts")
    rows = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                row = json.loads(line)
                # The Phase 1 export marks labelled rows; the contract-v1 corpus
                # carries labels directly. Both are usable supervision.
                if (row.get("labelled") or row.get("labels")) and row.get("input", "").strip():
                    rows[row["id"]] = row
    return rows


def load_splits(path: Path = SPLITS) -> dict:
    if not path.exists():
        raise SystemExit(f"No splits at {path}. Run: python3 tools/models/phase1_split.py")
    return json.loads(path.read_text(encoding="utf-8"))


def labels_for(rows: dict[str, dict], ids: list[str], head: str) -> list:
    out = []
    for identifier in ids:
        value = (rows[identifier].get("labels") or {}).get(LABEL_KEYS[head])
        out.append(value)
    return out


def bootstrap_ci(y_true: list, y_pred: list, metric, samples: int = BOOTSTRAP) -> tuple[float, float]:
    """Percentile interval over resampled items, which is what wide-and-small data needs."""
    rng = np.random.default_rng(SEED)
    n = len(y_true)
    if n == 0:
        return (float("nan"), float("nan"))
    stats = []
    for _ in range(samples):
        index = rng.integers(0, n, n)
        try:
            stats.append(metric([y_true[i] for i in index], [y_pred[i] for i in index]))
        except ValueError:
            continue
    if not stats:
        return (float("nan"), float("nan"))
    return (float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5)))


def expected_calibration_error(confidence: np.ndarray, correct: np.ndarray, bins: int = 5) -> float:
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = len(confidence)
    error = 0.0
    for low, high in zip(edges[:-1], edges[1:]):
        mask = (confidence > low) & (confidence <= high)
        if not mask.any():
            continue
        error += (mask.sum() / total) * abs(correct[mask].mean() - confidence[mask].mean())
    return float(error)


def score_head(head: str, train_x, train_y: list, eval_x, eval_y: list, eval_ids: list | None = None) -> dict:
    """Both candidates for one head, over whatever features the caller built.

    Features rather than text, so the same metrics, intervals and calibration
    apply to TF-IDF and to frozen encoder embeddings without a second scoring
    implementation drifting away from this one.
    """
    majority = max(set(train_y), key=train_y.count)
    prior_pred = [majority] * len(eval_y)

    # Class weighting only where the imbalance justifies it. Applying it to a
    # nearly balanced head like primary pushes predictions into the minority
    # class and collapses positive-class F1 below the prior, which is a property
    # of the setting rather than of the approach.
    counts = {value: train_y.count(value) for value in set(train_y)}
    imbalance = max(counts.values()) / min(counts.values()) if counts else 1
    weight = "balanced" if imbalance >= 3 else None
    model = LogisticRegression(max_iter=2000, C=4.0, class_weight=weight)
    model.fit(train_x, train_y)
    model_pred = list(model.predict(eval_x))

    ordinal = head in ORDINAL
    primary_metric = "macro_f1" if not ordinal else "mae"
    if head == "primary":
        primary_metric = "positive_f1"

    def primary(y_true, y_pred):
        if primary_metric == "mae":
            return mean_absolute_error(y_true, y_pred)
        if primary_metric == "positive_f1":
            return f1_score(y_true, y_pred, pos_label=True, zero_division=0)
        return f1_score(y_true, y_pred, average="macro", zero_division=0)

    model_point = float(primary(eval_y, model_pred))
    prior_point = float(primary(eval_y, prior_pred))
    low, high = bootstrap_ci(eval_y, model_pred, primary)

    # Direction matters: MAE is lower-is-better, the F1 family is higher-is-better.
    improvement = prior_point - model_point if primary_metric == "mae" else model_point - prior_point

    classes = sorted({*train_y, *eval_y}, key=str)
    probabilities = model.predict_proba(eval_x)
    confidence = probabilities.max(axis=1)
    correct = np.array([a == b for a, b in zip(eval_y, model_pred)])

    return {
        "promoted": head in PROMOTED,
        "primary_metric": primary_metric,
        "classes_in_use": len(classes),
        "evaluated": len(eval_y),
        "prior": {"point": round(prior_point, 4), "majority_class": str(majority)},
        "candidate": {
            "point": round(model_point, 4),
            "ci95": [round(low, 4), round(high, 4)],
            "delta_vs_prior": round(improvement, 4),
            "better_than_prior": improvement > 0,
        },
        "accuracy": round(float(accuracy_score(eval_y, model_pred)), 4),
        "macro_f1": round(float(f1_score(eval_y, model_pred, average="macro", zero_division=0)), 4),
        "per_class_f1": {
            str(cls): round(float(score), 4)
            for cls, score in zip(classes, f1_score(eval_y, model_pred, average=None, labels=classes, zero_division=0))
        },
        "ordinal": (
            {
                "mae": round(float(mean_absolute_error(eval_y, model_pred)), 4),
                "spearman": round(float(spearmanr(eval_y, model_pred).statistic), 4),
                "quadratic_weighted_kappa": round(float(cohen_kappa_score(eval_y, model_pred, weights="quadratic")), 4),
                "ece": round(expected_calibration_error(confidence, correct), 4),
            }
            if ordinal
            else None
        ),
        # Per-item predictions, so two candidates can be compared pairwise on the
        # same validation rows instead of by eyeballing two overlapping intervals.
        "predictions": [str(value) for value in model_pred],
        "eval_ids": eval_ids or [],
        "ece": None if ordinal else round(expected_calibration_error(confidence, correct), 4),
        "confusion": {
            "labels": [str(cls) for cls in classes],
            "matrix": confusion_matrix(eval_y, model_pred, labels=classes).tolist(),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", action="store_true", help="read the test split once, at the end")
    parser.add_argument("--head", default=None, help="score one head only")
    parser.add_argument("--dataset", default=None, help="dataset file; defaults to the original Phase 1 export")
    parser.add_argument("--splits", default=None, help="splits file; defaults to the original Phase 1 split")
    parser.add_argument("--tag", default=None, help="suffix for the results file, e.g. contract1")
    args = parser.parse_args()

    rows = load_rows(Path(args.dataset) if args.dataset else DATASET)
    split_data = load_splits(Path(args.splits) if args.splits else SPLITS)
    splits = split_data["splits"]
    meta = split_data["meta"]

    evaluated_on = "test" if args.final else "validation"
    if args.final and meta.get("test_items_the_audit_saw"):
        print(f"note: {meta['test_items_the_audit_saw']} test items were seen by the audit")

    train_ids = splits["train"]
    eval_ids = splits[evaluated_on]
    train_text = [rows[i]["input"] for i in train_ids]
    eval_text = [rows[i]["input"] for i in eval_ids]

    # Text features for the TF-IDF candidate. The encoder benchmark builds its
    # own features and calls the same scorer.
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=2)
    train_features = vectorizer.fit_transform(train_text)
    eval_features = vectorizer.transform(eval_text)

    heads = [args.head] if args.head else HEADS
    report = {
        "phase": "1 candidate benchmark (partial: prior and tf-idf logistic regression)",
        "ranAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "evaluated_on": evaluated_on,
        "test_split_read": bool(args.final),
        # The label target, stated per result so a later reader cannot mistake
        # these numbers for agreement with a canonical contract.
        "label_target": {
            "description": "Pulse stored labels, exactly as they are, as of the dataset snapshot",
            "engine": "one engine produced all 674 labels (deepseek-v4-flash)",
            "prompt_version": "unknown for historical labels; not recorded before this work",
            "taxonomy_version": (json.loads(META.read_text(encoding="utf-8")).get("taxonomyVersion") if META.exists() else None),
            "canonical_input_version": (
                json.loads(META.read_text(encoding="utf-8")).get("canonicalInputVersion") if META.exists() else None
            ),
            "label_audit": "results/label-audit.json records agreement with a re-run of the current teacher",
            "caveat": "Phase 0 measured contract drift, so these are not a canonical contract",
        },
        "splits": {name: len(ids) for name, ids in splits.items()},
        "seed": SEED,
        "bootstrap_samples": BOOTSTRAP,
        "heads": {},
    }

    print(f"evaluated on {evaluated_on}: {len(eval_ids)} items, trained on {len(train_ids)}")
    print(f"{'head':<9}{'metric':<13}{'prior':>8}{'candidate':>11}{'delta':>8}   ci95")
    for head in heads:
        train_y = labels_for(rows, train_ids, head)
        eval_y = labels_for(rows, eval_ids, head)

        keep_train = [i for i, value in enumerate(train_y) if value is not None]
        keep_eval = [i for i, value in enumerate(eval_y) if value is not None]
        train_y = [train_y[i] for i in keep_train]
        eval_y = [eval_y[i] for i in keep_eval]

        if len(set(train_y)) < 2 or len(eval_y) < 10:
            report["heads"][head] = {"skipped": "too few labelled rows to score"}
            print(f"{head:<9}{'skipped':<13}")
            continue

        stats = score_head(
            head,
            train_features[keep_train],
            train_y,
            eval_features[keep_eval],
            eval_y,
            [eval_ids[i] for i in keep_eval],
        )
        report["heads"][head] = stats
        print(
            f"{head:<9}{stats['primary_metric']:<13}{stats['prior']['point']:>8}"
            f"{stats['candidate']['point']:>11}{stats['candidate']['delta_vs_prior']:>8}   "
            f"{stats['candidate']['ci95']}"
        )

    RESULTS.mkdir(parents=True, exist_ok=True)
    suffix = f"-{args.tag}" if args.tag else ""
    name = f"baseline-results{suffix}.json" if not args.final else f"final-test-results{suffix}.json"
    (RESULTS / name).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {RESULTS / name}")


if __name__ == "__main__":
    main()
