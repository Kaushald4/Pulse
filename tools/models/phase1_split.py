"""
Phase 1 splits.

Three rules, all of which exist because Phase 0 showed what can go wrong.

1. The split is chronological. A model is trained on the past and evaluated on
   the future, so a randomly drawn test set cannot flatter it with near copies of
   its own training rows.
2. Items sharing a canonical URL are one story and stay in one split. Phase 0
   counted 184 rows in multi item groups and 120 title collisions, so a random
   split would leak the same story across the boundary.
3. The test split is drawn from items the label audit never looked at. The audit
   examined 400 of the 674 labelled items to understand label quality, and a
   model tested on those would be measured on data a human has already read
   carefully. Items the audit touched are marked, used freely for training and
   validation, and avoided for the final evaluation.

Decisions are made on validation. The test split is read once, at the end.

    python3 tools/models/phase1_split.py [--seed 20260922]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"

DATASET = ARTIFACTS / "dataset.jsonl"
SAMPLE = ARTIFACTS / "label-audit-sample.jsonl"
SPLITS = ARTIFACTS / "splits.json"

# Shares of the whole labelled set. Validation is deliberately as large as the
# test split, because candidate comparison happens there and needs the power;
# calibration gets its own slice so it is never fitted on judged rows.
VALIDATION_SHARE = 0.20
CALIBRATION_SHARE = 0.10
TEST_TARGET = 60


def load_rows() -> list[dict]:
    if not DATASET.exists():
        raise SystemExit(f"No dataset at {DATASET}. Run: npx tsx scripts/models/export-dataset.ts")
    rows = []
    with DATASET.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return [row for row in rows if row.get("labelled") and row.get("input", "").strip()]


def audited_ids() -> set[str]:
    if not SAMPLE.exists():
        return set()
    ids = set()
    with SAMPLE.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                ids.add(json.loads(line)["id"])
    return ids


def story_key(row: dict) -> str:
    """One story, however many times it was collected."""
    url = (row.get("meta") or {}).get("canonicalUrl")
    if url:
        return url
    return "id:" + row["id"]


def story_time(rows: list[dict]) -> str:
    """A group's sort key is its newest publication, so time never runs backwards."""
    times = [(row.get("meta") or {}).get("publishedAt") or (row.get("meta") or {}).get("createdAt") or "" for row in rows]
    return max(times) if times else ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20260922)
    args = parser.parse_args()

    rows = load_rows()
    audited = audited_ids()

    stories: dict[str, list[dict]] = {}
    for row in rows:
        stories.setdefault(story_key(row), []).append(row)

    ordered = sorted(stories.items(), key=lambda item: story_time(item[1]))

    # The test split is the newest slice the audit never examined. Walking from
    # the newest story backwards means the final evaluation is both the most
    # recent period and the only part of the data a human has not already read
    # carefully during the label audit. Audited stories from the same period fall
    # into validation, which is where candidate comparison happens anyway.
    test: list[str] = []
    rest: list[tuple[str, list[dict]]] = []
    for key, members in reversed(ordered):
        ids = [row["id"] for row in members]
        seen = any(identifier in audited for identifier in ids)
        if len(test) < TEST_TARGET and not seen:
            test.extend(ids)
        else:
            rest.append((key, members))
    rest.reverse()

    # The rest is a chronological cascade, oldest first: train, then calibration,
    # then validation, so validation sits closest in time to the test period.
    remaining = sum(len(members) for _key, members in rest)
    validation_n = int(remaining * VALIDATION_SHARE)
    calibration_n = int(remaining * CALIBRATION_SHARE)
    train_n = remaining - validation_n - calibration_n

    splits: dict[str, list[str]] = {"train": [], "validation": [], "calibration": [], "test": test}
    cursor = 0
    for _key, members in rest:
        bucket = "train" if cursor < train_n else "validation" if cursor < train_n + validation_n else "calibration"
        splits[bucket].extend(row["id"] for row in members)
        cursor += len(members)

    counts = {name: len(ids) for name, ids in splits.items()}
    seen = sum(1 for row in rows if row["id"] in audited)
    test_audited = sum(1 for row in rows if row["id"] in set(splits["test"]) and row["id"] in audited)

    meta = {
        "seed": args.seed,
        "labelled_usable": len(rows),
        "stories": len(ordered),
        "audited_items_in_dataset": seen,
        "counts": counts,
        "test_items_the_audit_saw": test_audited,
        "rules": [
            "chronological by story, newest period is the test split",
            "one story (canonical url group) never straddles a split",
            "test prefers items the label audit did not examine",
            "candidate comparison uses validation and calibration only",
        ],
    }
    SPLITS.write_text(json.dumps({"meta": meta, "splits": splits}, indent=2) + "\n", encoding="utf-8")
    RESULTS.mkdir(parents=True, exist_ok=True)

    print(f"labelled usable {len(rows)} in {len(ordered)} stories")
    for name in ("train", "validation", "calibration", "test"):
        print(f"  {name:<12} {counts[name]:>4} items")
    print(f"the audit examined {seen} items; {test_audited} of them are in the test split")
    print(f"wrote {SPLITS}")


if __name__ == "__main__":
    main()
