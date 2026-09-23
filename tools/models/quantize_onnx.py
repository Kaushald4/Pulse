"""
INT8 quantization, with the size question answered the way the criterion means it.

Weights and tokenizer are reported as the model artifact, separately from the
ONNX Runtime library, which is a per-platform installation cost rather than part
of the model. The frozen 40MB criterion applies to the artifact, so this reports
both numbers and labels them, rather than blending them into one figure.

Quantization is measured rather than assumed harmless: the same fixtures are
encoded before and after, and the cosine similarity between the two embedding
sets is reported alongside the size.

    tools/models/.venv/bin/python tools/models/quantize_onnx.py [--force]
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
from onnxruntime.quantization import QuantType, quantize_dynamic

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parity_onnx import FIXTURE_TEXTS, MODELS, download, encode, load  # noqa: E402
from phase1_encoders import onnxruntime_library_bytes  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"
QUANTIZED = ARTIFACTS / "quantized"

MODEL_ARTIFACT_LIMIT = 40 * 1024 * 1024


def session_for(path: Path):
    import onnxruntime as ort

    return ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    QUANTIZED.mkdir(parents=True, exist_ok=True)
    report = {
        "ranAt": datetime.now().isoformat(timespec="seconds"),
        "criterion": {
            "model_artifact_limit_bytes": MODEL_ARTIFACT_LIMIT,
            "applies_to": "onnx weights plus tokenizer",
            "excludes": "onnxruntime library, reported separately as a per-platform install cost",
        },
        "onnxruntime_library_bytes": onnxruntime_library_bytes(),
        "models": {},
    }

    print(f"onnxruntime library {onnxruntime_library_bytes() / 1e6:.1f}MB per platform (not part of the model artifact)")
    print(f"{'model':<20}{'fp32':>10}{'int8':>10}{'reduction':>11}{'min cosine':>12}   artifact vs 40MB")

    for name, spec in MODELS.items():
        fp32_path = download(spec["candidate"], "onnx/model.onnx")
        tokenizer_path = download(spec["candidate"], "tokenizer.json")
        int8_path = QUANTIZED / f"{name}-int8.onnx"

        if args.force or not int8_path.exists():
            quantize_dynamic(str(fp32_path), str(int8_path), weight_type=QuantType.QInt8)

        tokenizer_bytes = tokenizer_path.stat().st_size
        fp32_artifact = fp32_path.stat().st_size + tokenizer_bytes
        int8_artifact = int8_path.stat().st_size + tokenizer_bytes

        tokenizer = load(spec["candidate"])[1]
        before, _ = encode(session_for(fp32_path), tokenizer, FIXTURE_TEXTS, spec["pooling"])
        after, _ = encode(session_for(int8_path), tokenizer, FIXTURE_TEXTS, spec["pooling"])
        min_cosine = float((before * after).sum(axis=1).min())
        max_abs = float(np.abs(before - after).max())

        entry = {
            "repo": spec["candidate"],
            "pooling": spec["pooling"],
            "dimension": spec["dim"],
            "fp32": {
                "weights_bytes": fp32_path.stat().st_size,
                "tokenizer_bytes": tokenizer_bytes,
                "artifact_bytes": fp32_artifact,
            },
            "int8": {
                "weights_bytes": int8_path.stat().st_size,
                "tokenizer_bytes": tokenizer_bytes,
                "artifact_bytes": int8_artifact,
                "path": str(int8_path.relative_to(ROOT)),
            },
            "reduction": round(int8_artifact / fp32_artifact, 4),
            "embedding_drift": {"min_cosine": min_cosine, "max_abs_diff": max_abs},
            "artifact_within_limit": int8_artifact <= MODEL_ARTIFACT_LIMIT,
        }
        report["models"][name] = entry

        verdict = "within" if entry["artifact_within_limit"] else "OVER"
        print(
            f"{name:<20}{fp32_artifact / 1e6:>9.1f}M{int8_artifact / 1e6:>9.1f}M"
            f"{entry['reduction']:>11.2f}{min_cosine:>12.5f}   {verdict}"
        )

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "quantization.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {RESULTS / 'quantization.json'}")


if __name__ == "__main__":
    main()
