"""
Phase 1 encoder benchmark: frozen MiniLM and BGE embeddings with linear heads.

Same split, same scorer, same bootstrap intervals as the TF-IDF candidate, so the
comparison is like for like. Nothing is fine-tuned here: the encoder runs frozen
and only a logistic head is fitted, which answers whether a 22M to 33M model
carries enough signal before anyone pays for training.

The ONNX pipeline is imported from the parity check rather than reimplemented, so
the tokenizer, pooling and normalization validated there are the ones measured
here.

Artifact size is reported in full: the model, the tokenizer, and the ONNX Runtime
shared library a shipped app would have to carry, not just the runtime or just
the weights.

    tools/models/.venv/bin/python tools/models/phase1_encoders.py [--model <name>]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from parity_onnx import MODELS, download, encode, load  # noqa: E402
from phase1_baselines import (  # noqa: E402
    BOOTSTRAP,
    DATASET,
    HEADS,
    META,
    ORDINAL,
    SEED,
    SPLITS,
    labels_for,
    load_rows,
    load_splits,
    score_head,
)

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"


def onnxruntime_library_bytes() -> int:
    """The shared library a packaged app has to include for this backend."""
    import onnxruntime

    capi = Path(onnxruntime.__file__).parent / "capi"
    libraries = [path for path in capi.glob("libonnxruntime*") if path.suffix in {".dylib", ".so", ".dll"}]
    return sum(path.stat().st_size for path in libraries)


def artifact_sizes(model_dir: Path, tokenizer_path: Path) -> dict:
    weights = model_dir.stat().st_size
    tokenizer = tokenizer_path.stat().st_size
    runtime = onnxruntime_library_bytes()
    return {
        "onnx_model_bytes": weights,
        "tokenizer_bytes": tokenizer,
        "onnxruntime_library_bytes": runtime,
        "total_bytes_without_app": weights + tokenizer + runtime,
        "note": "runtime is per platform; weights and tokenizer are shared",
    }


def encode_all(session, tokenizer, texts: list[str], pooling: str, batch: int = 64) -> np.ndarray:
    """Encode in bounded batches.

    A single call over a whole split makes attention cost grow with the split
    size, which is quadratic in memory and wall time. Batching keeps the cost
    proportional to the number of items instead.
    """
    vectors = []
    for start in range(0, len(texts), batch):
        chunk, _ = encode(session, tokenizer, texts[start : start + batch], pooling)
        vectors.append(chunk)
    return np.vstack(vectors) if vectors else np.zeros((0, 1), dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=None, help="benchmark one encoder only")
    parser.add_argument("--onnx", default=None, help="benchmark a local ONNX artifact instead of the repo default")
    parser.add_argument("--label", default=None, help="suffix for the results file, e.g. int8")
    parser.add_argument("--dataset", default=None, help="dataset file; defaults to the original Phase 1 export")
    parser.add_argument("--splits", default=None, help="splits file; defaults to the original Phase 1 split")
    args = parser.parse_args()

    rows = load_rows(Path(args.dataset) if args.dataset else DATASET)
    split_data = load_splits(Path(args.splits) if args.splits else SPLITS)
    splits = split_data["splits"]

    train_ids = splits["train"]
    eval_ids = splits["validation"]
    train_text = [rows[i]["input"] for i in train_ids]
    eval_text = [rows[i]["input"] for i in eval_ids]

    names = [args.model] if args.model else list(MODELS)
    report = {
        "phase": "1 candidate benchmark (frozen encoder embeddings, linear heads)",
        "ranAt": datetime.now().isoformat(timespec="seconds"),
        "evaluated_on": "validation",
        "test_split_read": False,
        "seed": SEED,
        "bootstrap_samples": BOOTSTRAP,
        "text_features": "frozen encoder embedding, normalized, logistic head only",
        "label_target": "Pulse stored labels as of the dataset snapshot (see baseline-results.json)",
        "models": {},
    }

    for name in names:
        spec = MODELS[name]
        if args.onnx:
            # A local artifact, so the same harness measures quantized weights.
            import onnxruntime as ort

            local = Path(args.onnx)
            session = ort.InferenceSession(str(local), providers=["CPUExecutionProvider"])
            tokenizer_path = download(spec["candidate"], "tokenizer.json")
            model_path = local
        else:
            model_path = download(spec["candidate"], "onnx/model.onnx")
            tokenizer_path = download(spec["candidate"], "tokenizer.json")
            session = load(spec["candidate"])[0]
        tokenizer = load(spec["candidate"])[1]

        train_embeddings = encode_all(session, tokenizer, train_text, spec["pooling"])
        eval_embeddings = encode_all(session, tokenizer, eval_text, spec["pooling"])

        sizes = artifact_sizes(model_path, tokenizer_path)
        entry = {
            "repo": spec["candidate"],
            "pooling": spec["pooling"],
            "dimension": int(train_embeddings.shape[1]),
            "is_finetuned": False,
            "parameters_note": "backbone frozen; only the linear head is fitted",
            "artifact_sizes": sizes,
            "heads": {},
        }

        print(f"\n{name}  dim={entry['dimension']}  pooling={spec['pooling']}")
        print(f"  artifacts: weights {sizes['onnx_model_bytes'] / 1e6:.1f}MB, "
              f"tokenizer {sizes['tokenizer_bytes'] / 1e3:.0f}KB, "
              f"onnxruntime {sizes['onnxruntime_library_bytes'] / 1e6:.1f}MB, "
              f"total {sizes['total_bytes_without_app'] / 1e6:.1f}MB")
        print(f"  {'head':<9}{'metric':<13}{'prior':>8}{'candidate':>11}{'delta':>8}   ci95")

        for head in HEADS:
            train_y = labels_for(rows, train_ids, head)
            eval_y = labels_for(rows, eval_ids, head)
            keep_train = [i for i, value in enumerate(train_y) if value is not None]
            keep_eval = [i for i, value in enumerate(eval_y) if value is not None]
            train_labels = [train_y[i] for i in keep_train]
            eval_labels = [eval_y[i] for i in keep_eval]

            if len(set(train_labels)) < 2 or len(eval_labels) < 10:
                entry["heads"][head] = {"skipped": "too few labelled rows to score"}
                continue

            stats = score_head(
                head,
                np.asarray(train_embeddings[keep_train]),
                train_labels,
                np.asarray(eval_embeddings[keep_eval]),
                eval_labels,
                [eval_ids[i] for i in keep_eval],
            )
            entry["heads"][head] = stats
            print(
                f"  {head:<9}{stats['primary_metric']:<13}{stats['prior']['point']:>8}"
                f"{stats['candidate']['point']:>11}{stats['candidate']['delta_vs_prior']:>8}   "
                f"{stats['candidate']['ci95']}"
            )

        report["models"][name] = entry

    RESULTS.mkdir(parents=True, exist_ok=True)
    suffix = f"-{args.label}" if args.label else ""
    (RESULTS / f"encoder-results{suffix}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {RESULTS / f'encoder-results{suffix}.json'}")


if __name__ == "__main__":
    main()
