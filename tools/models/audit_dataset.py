"""
Phase 0 dataset audit.

Reads the dataset exported by `scripts/models/export-dataset.ts` and reports what
the labelled data can actually support: per-head class counts and imbalance,
missing labels, source and temporal spread, how many labels came from which
engine, duplicate and repost risk, body availability, and how many items have
content that changed since they were classified.

Standard library only, and no notebook: the report is reproducible from this file
and the dataset snapshot it names.

    python3 tools/models/audit_dataset.py
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"

DATASET = ARTIFACTS / "dataset.jsonl"
META = ARTIFACTS / "dataset.meta.json"

HEADS = ["category", "field", "topic", "signal", "primary", "whyKey"]

# The dataset stores the ordinal head under the name the app uses internally, so
# a head is not always its own key here. Getting this wrong reports a head as
# entirely missing when it is fully populated.
LABEL_KEYS = {
    "category": "category",
    "field": "field",
    "topic": "topic",
    "signal": "signalLevel",
    "primary": "primary",
    "whyKey": "whyKey",
}


def load_rows() -> list[dict]:
    if not DATASET.exists():
        raise SystemExit(f"No dataset at {DATASET}. Run: npx tsx scripts/models/export-dataset.ts")
    rows = []
    with DATASET.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_meta() -> dict:
    if META.exists():
        return json.loads(META.read_text(encoding="utf-8"))
    return {}


def label_value(row: dict, head: str):
    if not row.get("labelled"):
        return None
    return (row.get("labels") or {}).get(LABEL_KEYS[head])


def usable(row: dict) -> bool:
    """A labelled row whose input text carries more than a bare title."""
    return bool(row.get("labelled")) and len(row.get("input", "").strip()) > 0


def head_report(rows: list[dict]) -> dict:
    report = {}
    for head in HEADS:
        values = [label_value(row, head) for row in rows if row.get("labelled")]
        present = [value for value in values if value is not None]
        counts = Counter(present)
        missing = len(values) - len(present)
        ordered = sorted(counts.items(), key=lambda item: (-item[1], str(item[0])))
        largest = ordered[0][1] if ordered else 0
        smallest = min(counts.values()) if counts else 0
        report[head] = {
            "labelled": len(values),
            "present": len(present),
            "missing": missing,
            "classes_seen": len(counts),
            "counts": dict(ordered),
            "largest_class": largest,
            "smallest_class": smallest,
            # A head dominated by one value cannot be judged by accuracy alone.
            "imbalance_ratio": round(largest / smallest, 2) if smallest else None,
            "majority_baseline": round(largest / len(present), 4) if present else None,
        }
    return report


def source_report(rows: list[dict]) -> dict:
    labelled = [row for row in rows if row.get("labelled")]
    all_sources = Counter(row["meta"]["source"] for row in rows)
    labelled_sources = Counter(row["meta"]["source"] for row in labelled)
    return {
        "distinct_sources": len(all_sources),
        "top_by_items": dict(all_sources.most_common(12)),
        "top_by_labelled": dict(labelled_sources.most_common(12)),
    }


def temporal_report(rows: list[dict]) -> dict:
    published = Counter((row["meta"].get("publishedAt") or "")[:7] for row in rows)
    labelled_at = Counter((row["provenance"].get("labelledAt") or "")[:7] for row in rows if row.get("labelled"))
    return {
        "by_published_month": dict(sorted((key, value) for key, value in published.items() if key)),
        "by_labelled_month": dict(sorted((key, value) for key, value in labelled_at.items() if key)),
    }


def provenance_report(rows: list[dict]) -> dict:
    label_ages = Counter()
    confidences = []
    for row in rows:
        if not row.get("labelled"):
            continue
        label_ages[row["provenance"].get("engine") or "unknown"] += 1
        confidence = row["provenance"].get("confidence")
        if isinstance(confidence, (int, float)):
            confidences.append(float(confidence))
    confidences.sort()
    median = confidences[len(confidences) // 2] if confidences else None
    return {
        "by_engine": dict(label_ages.most_common()),
        "distinct_engines": len(label_ages),
        "confidence": {
            "count": len(confidences),
            "mean": round(sum(confidences) / len(confidences), 4) if confidences else None,
            "median": median,
            "min": confidences[0] if confidences else None,
            "max": confidences[-1] if confidences else None,
        },
    }


def duplicate_report(rows: list[dict]) -> dict:
    """Repost risk, measured on story identity rather than row count."""
    groups = Counter()
    missing = 0
    for row in rows:
        url = row["meta"].get("canonicalUrl")
        if not url:
            missing += 1
            continue
        groups[url] += 1
    sizes = Counter(groups.values())
    titles = Counter()
    for row in rows:
        key = "".join(ch for ch in row["input"].splitlines()[0].lower() if ch.isalnum())
        titles[key] += 1
    title_collisions = sum(count - 1 for count in titles.values() if count > 1)
    return {
        "items_without_canonical_url": missing,
        "distinct_canonical_urls": len(groups),
        "groups": {str(size): count for size, count in sorted(sizes.items())},
        "largest_group": max(groups.values()) if groups else 0,
        "rows_in_multi_item_groups": sum(size for size in groups.values() if size > 1),
        "title_collisions": title_collisions,
    }


def text_report(rows: list[dict]) -> dict:
    labelled = [row for row in rows if row.get("labelled")]
    with_excerpt = 0
    lengths = []
    for row in labelled:
        if "excerpt: " in row["input"]:
            with_excerpt += 1
            lengths.append(len(row["input"].split("excerpt: ", 1)[1]))
    lengths.sort()
    return {
        "labelled_with_excerpt": with_excerpt,
        "labelled_without_excerpt": len(labelled) - with_excerpt,
        "excerpt_chars": {
            "min": lengths[0] if lengths else None,
            "median": lengths[len(lengths) // 2] if lengths else None,
            "max": lengths[-1] if lengths else None,
        },
    }


def main() -> None:
    rows = load_rows()
    meta = load_meta()
    labelled = [row for row in rows if row.get("labelled")]
    usable_rows = [row for row in rows if usable(row)]

    content_changed = sum(1 for row in rows if row["provenance"].get("contentChanged"))

    report = {
        "phase": 0,
        "dataset": meta,
        "totals": {
            "rows": len(rows),
            "labelled": len(labelled),
            "unlabelled": len(rows) - len(labelled),
            "usable": len(usable_rows),
            "content_changed_since_classification": content_changed,
        },
        "heads": head_report(rows),
        "sources": source_report(rows),
        "temporal": temporal_report(rows),
        "provenance": provenance_report(rows),
        "duplicates": duplicate_report(rows),
        "text": text_report(rows),
    }

    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / "phase0.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(f"dataset rows {len(rows)}, labelled {len(labelled)}, usable {len(usable_rows)}")
    print(f"content changed since classification: {content_changed}")
    print()
    print(f"{'head':<9}{'present':>8}{'missing':>8}{'classes':>8}{'imbalance':>11}{'majority':>10}")
    for head, stats in report["heads"].items():
        print(
            f"{head:<9}{stats['present']:>8}{stats['missing']:>8}{stats['classes_seen']:>8}"
            f"{str(stats['imbalance_ratio']):>11}{str(stats['majority_baseline']):>10}"
        )
    print()
    for head, stats in report["heads"].items():
        print(f"{head}: " + ", ".join(f"{value}={count}" for value, count in stats["counts"].items()))
    print()
    print(f"engines: {report['provenance']['by_engine']}")
    print(f"sources: {report['sources']['top_by_labelled']}")
    print(
        "duplicates: "
        f"{report['duplicates']['distinct_canonical_urls']} canonical urls for {len(rows)} rows, "
        f"{report['duplicates']['rows_in_multi_item_groups']} rows in multi-item groups, "
        f"{report['duplicates']['title_collisions']} title collisions"
    )
    print(f"text: {report['text']}")
    print()
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
