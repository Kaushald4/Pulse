"""
Splits for the contract-v1 corpus.

Same rules as the original Phase 1 split, applied to the re-labelled corpus:

  - chronological, so the model is trained on the past and evaluated on the future
  - one story (canonical URL group) never straddles a boundary
  - the test slice is held back and unread

The contract-v1 corpus needs no audit-exclusion rule: the label audit ran before
these rows were labelled, so it never examined any of them. Times and story
identity are read from the re-labelling snapshot, because the corpus file carries
labels rather than item metadata.

The original 674-row dataset and its split are not read or written here.

    python3 tools/models/contract1_split.py [--seed 20260922]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from sqlite3 import connect

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"

CORPUS = ARTIFACTS / "relabel-corpus.jsonl"
SNAPSHOT = ARTIFACTS / "snapshot-relabel" / "pulse.db"
SPLITS = ARTIFACTS / "contract1-splits.json"

VALIDATION_SHARE = 0.20
CALIBRATION_SHARE = 0.10
TEST_SHARE = 0.12


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20260922)
    args = parser.parse_args()

    if not CORPUS.exists():
        raise SystemExit(f"No corpus at {CORPUS}. Run: npx tsx scripts/models/relabel-corpus.ts")
    if not SNAPSHOT.exists():
        raise SystemExit(f"No snapshot at {SNAPSHOT}.")

    rows = [json.loads(line) for line in CORPUS.read_text(encoding="utf-8").splitlines() if line.strip()]

    connection = connect(f"file:{SNAPSHOT}?mode=ro", uri=True)
    meta = {
        identifier: (published or "", canonical or "")
        for identifier, published, canonical in connection.execute(
            "SELECT id, published_at, canonical_url FROM items"
        )
    }
    connection.close()

    stories: dict[str, list[str]] = {}
    for row in rows:
        published, canonical = meta.get(row["id"], ("", ""))
        stories.setdefault(canonical or f"id:{row['id']}", []).append(row["id"])

    ordered = sorted(stories.items(), key=lambda item: max(meta.get(i, ("", ""))[0] for i in item[1]))

    total = len(ordered)
    test_stories = max(1, int(total * TEST_SHARE))
    body = ordered[: total - test_stories]
    held = ordered[total - test_stories :]

    body_items = sum(len(members) for _key, members in body)
    validation_n = int(body_items * VALIDATION_SHARE)
    calibration_n = int(body_items * CALIBRATION_SHARE)

    splits = {"train": [], "validation": [], "calibration": [], "test": []}
    splits["test"] = [identifier for _key, members in held for identifier in members]

    cursor = 0
    for _key, members in body:
        bucket = (
            "train"
            if cursor < body_items - validation_n - calibration_n
            else "validation"
            if cursor < body_items - calibration_n
            else "calibration"
        )
        splits[bucket].extend(members)
        cursor += len(members)

    counts = {name: len(ids) for name, ids in splits.items()}
    report = {
        "corpus": str(CORPUS.relative_to(ROOT)),
        "seed": args.seed,
        "rows": len(rows),
        "stories": total,
        "counts": counts,
        "rules": [
            "chronological by story; newest slice is the test split",
            "one canonical URL group never straddles a split",
            "no audit exclusion needed: the audit predates these labels",
            "the original 674-row dataset and split are untouched",
        ],
    }
    SPLITS.write_text(json.dumps({"meta": report, "splits": splits}, indent=2) + "\n", encoding="utf-8")

    print(f"contract-v1 corpus: {len(rows)} rows in {total} stories")
    for name in ("train", "validation", "calibration", "test"):
        print(f"  {name:<12} {counts[name]:>4}")
    print(f"wrote {SPLITS}")


if __name__ == "__main__":
    main()
