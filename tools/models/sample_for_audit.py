"""
Builds the stratified sample for the label consistency audit.

The sample exists because a head's rarest classes decide what can be concluded.
`other` holds 42 percent of topics while `open-source` holds six items, so a
uniform random draw would under-represent exactly the cases a conclusion needs.
Every class gets a floor, the rest of the budget is filled proportionally, and
the draw is seeded so the same sample can be rebuilt.

Rows are written with their id only. Text and labels stay in the dataset.

    python3 tools/models/sample_for_audit.py --size 400 --seed 20260922
"""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"

DATASET = ARTIFACTS / "dataset.jsonl"
SAMPLE = ARTIFACTS / "label-audit-sample.jsonl"
SAMPLE_META = ARTIFACTS / "label-audit-sample.meta.json"

# The head the sample is stratified on. Topic is the widest and most imbalanced,
# so covering it also covers the long tail of category and whyKey.
STRATIFY_ON = "topic"
FLOOR_PER_CLASS = 12


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


def stratified_sample(rows: list[dict], size: int, seed: int) -> tuple[list[dict], dict]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        buckets[str((row.get("labels") or {}).get(STRATIFY_ON) or "missing")].append(row)

    rng = random.Random(seed)
    for bucket in buckets.values():
        rng.shuffle(bucket)

    chosen: list[dict] = []
    for name in sorted(buckets):
        chosen.extend(buckets[name][:FLOOR_PER_CLASS])

    # Top up to the requested size from whatever is left, so the larger classes
    # are represented in proportion once every class has its floor.
    picked = {row["id"] for row in chosen}
    remainder = [row for row in rows if row["id"] not in picked]
    rng.shuffle(remainder)
    if len(chosen) < size:
        chosen.extend(remainder[: max(0, size - len(chosen))])

    # Deterministic through the seed, but deliberately not sorted by id: ids
    # carry the source prefix, so an id-ordered sample puts every arXiv item in
    # the same request, a batch composition production never produces.
    rng.shuffle(chosen)
    coverage = {name: min(len(items), FLOOR_PER_CLASS) for name, items in sorted(buckets.items())}
    return chosen, {
        "stratified_on": STRATIFY_ON,
        "floor_per_class": FLOOR_PER_CLASS,
        "classes": {name: len(items) for name, items in sorted(buckets.items())},
        "floors_met": coverage,
        "labelled_available": len(rows),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", type=int, default=400)
    parser.add_argument("--seed", type=int, default=20260922)
    args = parser.parse_args()

    rows = load_rows()
    chosen, detail = stratified_sample(rows, args.size, args.seed)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with SAMPLE.open("w", encoding="utf-8") as handle:
        for row in chosen:
            handle.write(
                json.dumps(
                    {
                        "id": row["id"],
                        "input": row["input"],
                        "labels": row["labels"],
                        "provenance": row["provenance"],
                    }
                )
                + "\n"
            )

    SAMPLE_META.write_text(
        json.dumps({"size": len(chosen), "seed": args.seed, **detail}, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"sampled {len(chosen)} of {detail['labelled_available']} usable labelled items")
    print(f"seed {args.seed}, floor {FLOOR_PER_CLASS} per {STRATIFY_ON} class")
    thin = [name for name, count in detail["classes"].items() if count < FLOOR_PER_CLASS]
    print(f"classes below the floor: {thin if thin else 'none'}")
    print(f"wrote {SAMPLE}")


if __name__ == "__main__":
    main()
