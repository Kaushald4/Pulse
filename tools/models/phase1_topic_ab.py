"""
Topic A/B: direct N-way classification against hierarchical field then topic.

Neither is assumed better. Three numbers are reported on the same validation
split, because the interesting quantity is not which wins but how much of the
hierarchy's cost is its own and how much is field errors propagating:

  direct          one 16-way classifier over topic
  hierarchical    predicted field picks a per-field topic classifier
  oracle field    the true field picks it, so the gap to the line above is
                  exactly the cost of field errors, nothing else

Fields with too few training rows fall back to the global topic classifier, and
the count of those is reported rather than hidden.

    tools/models/.venv/bin/python tools/models/phase1_topic_ab.py --model bge-small-en-v1.5
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score

sys.path.insert(0, str(Path(__file__).resolve().parent))

from parity_onnx import MODELS, encode, load  # noqa: E402
from phase1_baselines import SEED, bootstrap_ci, labels_for, load_rows, load_splits  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "tools" / "models" / "results"

MIN_ROWS_PER_FIELD = 12


def fit_predict(train_x, train_y, eval_x, c: float = 4.0):
    model = LogisticRegression(max_iter=2000, C=c, class_weight="balanced")
    model.fit(train_x, train_y)
    return model, list(model.predict(eval_x))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="bge-small-en-v1.5")
    args = parser.parse_args()

    spec = MODELS[args.model]
    rows = load_rows()
    splits = load_splits()["splits"]
    train_ids, eval_ids = splits["train"], splits["validation"]

    session, tokenizer = load(spec["candidate"])
    train_x, _ = encode(session, tokenizer, [rows[i]["input"] for i in train_ids], spec["pooling"])
    eval_x, _ = encode(session, tokenizer, [rows[i]["input"] for i in eval_ids], spec["pooling"])

    topic_train = labels_for(rows, train_ids, "topic")
    topic_eval = labels_for(rows, eval_ids, "topic")
    field_train = labels_for(rows, train_ids, "field")
    field_eval = labels_for(rows, eval_ids, "field")

    keep_train = [i for i, v in enumerate(topic_train) if v is not None]
    keep_eval = [i for i, v in enumerate(topic_eval) if v is not None]

    # A: direct.
    _model, direct_pred = fit_predict(train_x[keep_train], [topic_train[i] for i in keep_train], eval_x[keep_eval])
    direct_true = [topic_eval[i] for i in keep_eval]

    # Field classifier, for the predicted-field variant.
    field_keep_train = [i for i, v in enumerate(field_train) if v is not None]
    field_keep_eval = [i for i, v in enumerate(field_eval) if v is not None]
    _field_model, field_pred = fit_predict(
        train_x[field_keep_train], [field_train[i] for i in field_keep_train], eval_x[field_keep_eval]
    )
    predicted_field = dict(zip([eval_ids[i] for i in field_keep_eval], field_pred))

    def hierarchical(pick_field) -> list[str]:
        """Per-field topic classifiers, remembered so each field is fitted once."""
        by_field: dict[str, list[int]] = {}
        for index in keep_train:
            by_field.setdefault(str(topic_train[index] and field_train[index]), []).append(index)

        global_model = LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced")
        global_model.fit(train_x[keep_train], [topic_train[i] for i in keep_train])

        per_field = {}
        for field, indices in by_field.items():
            if len(indices) < MIN_ROWS_PER_FIELD or len({topic_train[i] for i in indices}) < 2:
                continue
            model = LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced")
            model.fit(train_x[indices], [topic_train[i] for i in indices])
            per_field[field] = model

        out = []
        for index in keep_eval:
            field = pick_field(eval_ids[index])
            model = per_field.get(str(field))
            if model is None:
                out.append(global_model.predict(eval_x[index].reshape(1, -1))[0])
            else:
                out.append(model.predict(eval_x[index].reshape(1, -1))[0])
        return out

    predicted = hierarchical(lambda identifier: predicted_field.get(identifier))
    oracle = hierarchical(lambda identifier: field_eval[eval_ids.index(identifier)])

    def summarise(predictions: list[str]) -> dict:
        return {
            "macro_f1": round(float(f1_score(direct_true, predictions, average="macro", zero_division=0)), 4),
            "accuracy": round(float(accuracy_score(direct_true, predictions)), 4),
            "macro_f1_ci95": [round(v, 4) for v in bootstrap_ci(direct_true, predictions, lambda a, b: f1_score(a, b, average="macro", zero_division=0))],
        }

    topic_counts = Counter(topic_train)
    per_field_sizes = Counter(str(topic_train[i] and None) for i in keep_train)
    report = {
        "ranAt": datetime.now().isoformat(timespec="seconds"),
        "model": args.model,
        "pooling": spec["pooling"],
        "evaluated_on": "validation",
        "evaluated": len(direct_true),
        "fields_with_own_classifier": sum(
            1
            for field in {str(field_train[i]) for i in keep_train}
            if sum(1 for i in keep_train if str(field_train[i]) == field) >= MIN_ROWS_PER_FIELD
        ),
        "min_rows_per_field": MIN_ROWS_PER_FIELD,
        "direct": summarise(direct_pred),
        "hierarchical_predicted_field": summarise(predicted),
        "hierarchical_oracle_field": summarise(oracle),
        "field_error_cost_macro_f1": round(
            float(f1_score(direct_true, oracle, average="macro", zero_division=0))
            - float(f1_score(direct_true, predicted, average="macro", zero_division=0)),
            4,
        ),
        "note": "field_error_cost is the macro F1 lost purely to predicting the field rather than knowing it",
        "seed": SEED,
    }

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "topic-ab.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(f"topic A/B on {args.model}, {len(direct_true)} validation items")
    for label, key in (
        ("direct 16-way", "direct"),
        ("hierarchical, predicted field", "hierarchical_predicted_field"),
        ("hierarchical, oracle field", "hierarchical_oracle_field"),
    ):
        stats = report[key]
        print(f"  {label:<30} macro_f1 {stats['macro_f1']:.4f}  accuracy {stats['accuracy']:.4f}  ci95 {stats['macro_f1_ci95']}")
    print(f"  cost of field errors: {report['field_error_cost_macro_f1']:+.4f} macro F1")
    print(f"wrote {RESULTS / 'topic-ab.json'}")


if __name__ == "__main__":
    main()
