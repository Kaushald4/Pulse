"""
ONNX versus reference numerical parity, for the two candidate encoders.

The reference is the publisher's own ONNX export (`sentence-transformers` for
MiniLM, `BAAI` for BGE), compared against the `Xenova` export this project would
actually use. Two independent exports of the same weights must agree vector for
vector, which is what catches tokenizer, export, dtype and tensor-order mistakes
before any quality number is trusted. No training stack is needed.

Pooling is the part no export states, so each model declares it here from its own
sentence-transformers configuration: mean for MiniLM, CLS for BGE. Two further
checks cover the cases a vector comparison cannot see:

  unit_norm_err     the pooled vector is normalized, not just pooled
  batch_invariance  the same text gets the same vector regardless of its
                    neighbours, which is how a masking or padding bug shows up

    tools/models/.venv/bin/python tools/models/parity_onnx.py [--tolerance 1e-3]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"

MAX_LENGTH = 512

MODELS = {
    "all-MiniLM-L6-v2": {
        "candidate": "Xenova/all-MiniLM-L6-v2",
        "reference": "sentence-transformers/all-MiniLM-L6-v2",
        "pooling": "mean",
        "dim": 384,
    },
    "bge-small-en-v1.5": {
        "candidate": "Xenova/bge-small-en-v1.5",
        "reference": "BAAI/bge-small-en-v1.5",
        "pooling": "cls",
        "dim": 384,
    },
}

FIXTURE_TEXTS = [
    "title: A 0.6B decision model\nsource: hackernews\nurl: https://example.com/a\nexcerpt: A small encoder beats a large one on a closed vocabulary.",
    "title: Postgres 18 released\nsource: rss\nurl: https://example.com/b\nexcerpt: Logical replication gains a new apply worker.",
    "title: Show HN: a terminal file manager\nsource: hackernews\nurl: https://example.com/c\nexcerpt: Written in Rust, 40ms cold start.",
    "title: Kernel patch review\nsource: lobsters\nurl: https://example.com/d\nexcerpt: The scheduler change reduces wakeup latency under load.",
    "title: Survey of retrieval evaluation\nsource: arxiv\nurl: https://arxiv.org/abs/1\nexcerpt: We compare eight retrieval benchmarks and their leakage.",
    "title: Browser extension supply chain\nsource: rss\nurl: https://example.com/e\nexcerpt: A compromised update exfiltrated session cookies for six hours.",
]


def download(repo: str, name: str) -> Path:
    from huggingface_hub import hf_hub_download

    return Path(hf_hub_download(repo, name, cache_dir=ARTIFACTS / "hf"))


def revision(repo: str) -> str:
    from huggingface_hub import HfApi

    try:
        return HfApi().model_info(repo).sha or "unknown"
    except Exception as error:  # a pinned revision is recorded, not required
        return f"unresolved: {type(error).__name__}"


def load(repo: str):
    import onnxruntime as ort
    from tokenizers import Tokenizer

    session = ort.InferenceSession(str(download(repo, "onnx/model.onnx")), providers=["CPUExecutionProvider"])
    tokenizer = Tokenizer.from_file(str(download(repo, "tokenizer.json")))
    tokenizer.enable_truncation(max_length=MAX_LENGTH)
    tokenizer.enable_padding()
    return session, tokenizer


def pool(hidden: np.ndarray, mask: np.ndarray, how: str) -> np.ndarray:
    if how == "cls":
        pooled = hidden[:, 0]
    else:
        weights = mask[..., None].astype(hidden.dtype)
        pooled = (hidden * weights).sum(axis=1) / np.clip(weights.sum(axis=1), 1e-9, None)
    return pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9, None)


def encode(session, tokenizer, texts: list[str], pooling: str) -> tuple[np.ndarray, list[list[int]]]:
    batch = tokenizer.encode_batch(texts)
    input_ids = np.array([item.ids for item in batch], dtype=np.int64)
    mask = np.array([item.attention_mask for item in batch], dtype=np.int64)
    feeds = {"input_ids": input_ids, "attention_mask": mask}
    # Only what the graph declares is passed: exports differ on token_type_ids.
    declared = {item.name for item in session.get_inputs()}
    if "token_type_ids" in declared:
        feeds["token_type_ids"] = np.zeros_like(input_ids)
    hidden = np.asarray(session.run(None, feeds)[0], dtype=np.float32)
    return pool(hidden, mask, pooling), [item.ids for item in batch]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tolerance", type=float, default=1e-3)
    args = parser.parse_args()

    report = {"max_length": MAX_LENGTH, "tolerance": args.tolerance, "fixtures": len(FIXTURE_TEXTS), "models": {}}
    failures = 0

    for name, spec in MODELS.items():
        candidate_session, candidate_tokenizer = load(spec["candidate"])
        reference_session, reference_tokenizer = load(spec["reference"])

        actual, actual_ids = encode(candidate_session, candidate_tokenizer, FIXTURE_TEXTS, spec["pooling"])
        reference, reference_ids = encode(reference_session, reference_tokenizer, FIXTURE_TEXTS, spec["pooling"])

        max_abs = float(np.abs(actual - reference).max())
        min_cosine = float((actual * reference).sum(axis=1).min())
        unit_norm_err = float(np.abs(np.linalg.norm(actual, axis=1) - 1).max())
        tokens_match = actual_ids == reference_ids
        solo, _ = encode(candidate_session, candidate_tokenizer, [FIXTURE_TEXTS[0]], spec["pooling"])
        batch_invariance = float(np.abs(actual[0] - solo[0]).max())

        ok = (
            actual.shape == reference.shape
            and actual.shape[1] == spec["dim"]
            and max_abs <= args.tolerance
            and unit_norm_err <= 1e-4
            and tokens_match
            and batch_invariance <= args.tolerance
        )
        failures += 0 if ok else 1

        report["models"][name] = {
            "candidate_repo": spec["candidate"],
            "candidate_revision": revision(spec["candidate"]),
            "reference_repo": spec["reference"],
            "reference_revision": revision(spec["reference"]),
            "pooling": spec["pooling"],
            "dimension": int(actual.shape[1]),
            "max_abs_diff": max_abs,
            "min_cosine": min_cosine,
            "unit_norm_err": unit_norm_err,
            "token_ids_identical": bool(tokens_match),
            "batch_invariance": batch_invariance,
            "passed": bool(ok),
        }

        print(f"{name}  pooling={spec['pooling']}  dim={actual.shape[1]}")
        print(f"  max_abs_diff      {max_abs:.3e}")
        print(f"  min_cosine        {min_cosine:.8f}")
        print(f"  unit_norm_err     {unit_norm_err:.3e}")
        print(f"  token_ids_match   {tokens_match}")
        print(f"  batch_invariance  {batch_invariance:.3e}")
        print(f"  {'OK' if ok else 'FAIL'}")

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "numerical-parity.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nparity {'failed' if failures else 'holds'} at tolerance {args.tolerance}, wrote results/numerical-parity.json")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
