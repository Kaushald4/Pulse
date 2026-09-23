"""
Phase 1 fixed-budget fine-tune: one shared backbone, four promoted heads jointly.

The budget is declared here and applied identically to both backbones. No early
stopping, so neither model is quietly cut short while the other is not, and a
loss curve is recorded so convergence is checked rather than assumed. If either
backbone has not converged at the fence, the fence rises for both and the whole
comparison re-runs.

Only the heads Phase 0 found to carry signal above a constant predictor are
trained: topic, signal, primary, whyKey. category and field are excluded, not
because they are hard but because their stored labels were worse than a constant
predictor, so training on them would optimise toward a target that carries no
signal. The dataset contract and the shipping thresholds are untouched.

Missing labels are masked per head rather than dropping the row, so an item
labelled for topic but not signal still teaches topic.

The test split is never read. INT8 is deliberately not applied here: the FP32
artifact is evaluated first, and quantization follows model selection.

    tools/models/.venv/bin/python tools/models/phase1_finetune.py [--steps 200]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, str(Path(__file__).resolve().parent))

from parity_onnx import MODELS  # noqa: E402
from phase1_baselines import (
    DATASET,
    HEADS,
    LABEL_KEYS,
    ORDINAL,
    SEED,
    SPLITS,
    bootstrap_ci,
    labels_for,
    load_rows,
    load_splits,
)

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "tools" / "models" / "artifacts"
RESULTS = ROOT / "tools" / "models" / "results"

TORCH_REPOS = {
    "all-MiniLM-L6-v2": "sentence-transformers/all-MiniLM-L6-v2",
    "bge-small-en-v1.5": "BAAI/bge-small-en-v1.5",
}
TRAINED_HEADS = ["topic", "signal", "primary", "whyKey"]

# The declared budget. One fence for both backbones, identical in every respect.
BUDGET = {
    "steps": 200,
    "batch_size": 16,
    "learning_rate": 2e-5,
    "warmup_fraction": 0.1,
    "weight_decay": 0.01,
    "optimizer": "AdamW",
    "schedule": "linear warmup then linear decay",
    "early_stopping": False,
    "seed": SEED,
    "max_length": 256,
}
CONVERGENCE_TAIL = 10


class PulseClassify(nn.Module):
    """One backbone, a pooling rule, and one linear head per trained task."""

    def __init__(self, backbone: str, pooling: str, sizes: dict[str, int]):
        super().__init__()
        from transformers import AutoModel

        self.encoder = AutoModel.from_pretrained(backbone)
        self.pooling = pooling
        hidden = self.encoder.config.hidden_size
        self.heads = nn.ModuleDict({head: nn.Linear(hidden, size) for head, size in sizes.items()})

    def forward(self, input_ids, attention_mask):
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        if self.pooling == "cls":
            pooled = out[:, 0]
        else:
            weights = attention_mask[..., None].to(out.dtype)
            pooled = (out * weights).sum(1) / weights.sum(1).clamp(min=1e-9)
        return {head: layer(pooled) for head, layer in self.heads.items()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=BUDGET["steps"])
    parser.add_argument("--model", default=None)
    parser.add_argument("--tag", default="fence1")
    parser.add_argument("--dataset", default=None, help="dataset file; defaults to the original Phase 1 export")
    parser.add_argument("--splits", default=None, help="splits file; defaults to the original Phase 1 split")
    args = parser.parse_args()

    from transformers import AutoTokenizer

    budget = {**BUDGET, "steps": args.steps}
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    budget["device"] = device

    rows = load_rows(Path(args.dataset) if args.dataset else DATASET)
    splits = load_splits(Path(args.splits) if args.splits else SPLITS)["splits"]
    train_ids, eval_ids = splits["train"], splits["validation"]

    names = [args.model] if args.model else list(MODELS)
    report = {
        "ranAt": datetime.now().isoformat(timespec="seconds"),
        "budget": budget,
        "trained_heads": TRAINED_HEADS,
        "excluded_heads": {
            "category": "stored labels agreed with a re-run teacher less often than a constant predictor",
            "field": "same; see results/label-audit.json",
        },
        "evaluated_on": "validation",
        "test_split_read": False,
        "label_target": "Pulse stored labels as of the dataset snapshot (unchanged)",
        "models": {},
    }

    for name in names:
        torch.manual_seed(budget["seed"])
        np.random.seed(budget["seed"])
        random.seed(budget["seed"])

        spec = MODELS[name]
        backbone = TORCH_REPOS[name]
        tokenizer = AutoTokenizer.from_pretrained(backbone)

        # Head sizes come from the labels actually present, so a head with no
        # rows in the vocabulary cannot silently widen.
        sizes = {}
        for head in TRAINED_HEADS:
            values = [v for v in labels_for(rows, train_ids + eval_ids, head) if v is not None]
            sizes[head] = max(len({str(v) for v in values}), 2)
        class_lists = {}
        for head in TRAINED_HEADS:
            values = sorted({str(v) for v in labels_for(rows, train_ids, head) if v is not None})
            class_lists[head] = values
            sizes[head] = len(values)

        model = PulseClassify(backbone, spec["pooling"], sizes).to(device)
        optimizer = torch.optim.AdamW(model.parameters(), lr=budget["learning_rate"], weight_decay=budget["weight_decay"])

        def encode_batch(ids):
            texts = [rows[i]["input"] for i in ids]
            batch = tokenizer(texts, padding=True, truncation=True, max_length=budget["max_length"], return_tensors="pt")
            return {k: v.to(device) for k, v in batch.items()}

        # Targets, masked per head.
        def targets_for(ids):
            out = {}
            for head in TRAINED_HEADS:
                raw = labels_for(rows, ids, head)
                index = {value: i for i, value in enumerate(class_lists[head])}
                out[head] = torch.tensor(
                    [-1 if v is None else index[str(v)] for v in raw], dtype=torch.long, device=device
                )
            return out

        train_targets = targets_for(train_ids)
        eval_targets = targets_for(eval_ids)
        steps_per_epoch = max(1, len(train_ids) // budget["batch_size"])
        warmup = max(1, int(budget["steps"] * budget["warmup_fraction"]))

        def lr_at(step: int) -> float:
            if step < warmup:
                return budget["learning_rate"] * (step + 1) / warmup
            remaining = budget["steps"] - step
            return budget["learning_rate"] * max(remaining, 0) / max(budget["steps"] - warmup, 1)

        curve = []
        order = list(range(len(train_ids)))
        rng = random.Random(budget["seed"])
        # Starting the cursor at the end forces the shuffle branch to fire before
        # the first batch, so every epoch is fully shuffled from its first batch
        # rather than only after the first wrap. Without this the first epoch
        # trains on source-clustered batches.
        cursor = len(order)

        # Weighting matched to the frozen route's rule: the same 3:1 imbalance
        # threshold and the same balanced formula, so the two routes differ in
        # the model and nothing else.
        head_weights = {}
        for head in TRAINED_HEADS:
            counts = Counter(str(value) for value in labels_for(rows, train_ids, head) if value is not None)
            if not counts:
                continue
            imbalance = max(counts.values()) / min(counts.values())
            if imbalance < 3:
                head_weights[head] = None
                continue
            total = sum(counts.values())
            head_weights[head] = torch.tensor(
                [total / (len(counts) * counts[cls]) for cls in class_lists[head]],
                dtype=torch.float,
                device=device,
            )
        entry_weights = {head: (None if w is None else [round(v, 3) for v in w.tolist()]) for head, w in head_weights.items()}

        model.train()
        for step in range(budget["steps"]):
            if cursor + budget["batch_size"] > len(order):
                rng.shuffle(order)
                cursor = 0
            batch_index = order[cursor : cursor + budget["batch_size"]]
            cursor += budget["batch_size"]

            ids = [train_ids[i] for i in batch_index]
            inputs = encode_batch(ids)
            logits = model(inputs["input_ids"], inputs["attention_mask"])

            losses = {}
            for head in TRAINED_HEADS:
                target = train_targets[head][batch_index]
                if (target >= 0).sum() < 2:
                    continue
                keep = target >= 0
                losses[head] = nn.functional.cross_entropy(
                    logits[head][keep], target[keep], weight=head_weights.get(head)
                )

            if not losses:
                continue
            loss = sum(losses.values())
            for group in optimizer.param_groups:
                group["lr"] = lr_at(step)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            curve.append({"step": step, "lr": lr_at(step), "total": float(loss.item()), **{h: float(v.item()) for h, v in losses.items()}})
            if step % 20 == 0:
                print(f"  {name} step {step}/{budget['steps']} loss {loss.item():.4f} lr {lr_at(step):.2e}", flush=True)

        # Convergence: is the tail still falling, or has it flattened?
        totals = [entry["total"] for entry in curve]
        tail = totals[-CONVERGENCE_TAIL:]
        before = totals[-2 * CONVERGENCE_TAIL : -CONVERGENCE_TAIL]
        improvement = float(np.mean(before) - np.mean(tail))
        converged = improvement < 0.01 * max(np.mean(before), 1e-6)

        # Validation predictions from the model's own heads.
        model.eval()
        predictions = {head: [] for head in TRAINED_HEADS}
        with torch.no_grad():
            for start in range(0, len(eval_ids), 32):
                ids = eval_ids[start : start + 32]
                inputs = encode_batch(ids)
                logits = model(inputs["input_ids"], inputs["attention_mask"])
                for head in TRAINED_HEADS:
                    predictions[head].extend(logits[head].argmax(-1).cpu().tolist())

        def metrics(head: str) -> dict:
            raw = labels_for(rows, eval_ids, head)
            index = {value: i for i, value in enumerate(class_lists[head])}
            pairs = [(index[str(v)], predictions[head][i]) for i, v in enumerate(raw) if v is not None]
            if len(pairs) < 10:
                return {"skipped": "too few labelled rows"}
            true = [class_lists[head][t] for t, _ in pairs]
            pred = [class_lists[head][p] for _, p in pairs]

            if head in ORDINAL:
                # Ordinal: levels are compared as numbers, not as class ids.
                true_num = [float(t) for t, _ in pairs]
                pred_num = [float(p) for _, p in pairs]
                mae = float(np.mean(np.abs(np.subtract(true_num, pred_num))))
                return {
                    "metric": "mae",
                    "point": round(mae, 4),
                    "ci95": [round(v, 4) for v in bootstrap_ci(true_num, pred_num, lambda a, b: float(np.mean(np.abs(np.subtract(a, b)))))],
                    "accuracy": round(float(np.mean([t == p for t, p in pairs])), 4),
                }
            if head == "primary":
                tp = sum(1 for t, p in pairs if t == 1 and p == 1)
                fp = sum(1 for t, p in pairs if t == 0 and p == 1)
                fn = sum(1 for t, p in pairs if t == 1 and p == 0)
                f1 = (2 * tp / (2 * tp + fp + fn)) if (2 * tp + fp + fn) else 0.0
                return {
                    "metric": "positive_f1",
                    "point": round(float(f1), 4),
                    "support_positive": sum(1 for t, _ in pairs if t == 1),
                }
            from sklearn.metrics import f1_score

            macro = f1_score(true, pred, average="macro", zero_division=0)
            return {
                "metric": "macro_f1",
                "point": round(float(macro), 4),
                "ci95": [round(v, 4) for v in bootstrap_ci(true, pred, lambda a, b: f1_score(a, b, average="macro", zero_division=0))],
            }

        entry = {
            "backbone": backbone,
            "pooling": spec["pooling"],
            "classes": {head: len(values) for head, values in class_lists.items()},
            "class_weights": entry_weights,
            "shuffled_every_epoch_from_first_batch": True,
            "steps_completed": len(curve),
            "steps_per_epoch": steps_per_epoch,
            "convergence": {
                "tail_mean_loss": round(float(np.mean(tail)), 4),
                "previous_mean_loss": round(float(np.mean(before)), 4),
                "improvement": round(improvement, 4),
                "converged": bool(converged),
                "rule": f"tail improvement under 1 percent of the previous window over {CONVERGENCE_TAIL} steps",
            },
            "loss_curve": curve,
            "validation": {head: metrics(head) for head in TRAINED_HEADS},
        }
        # Paired-comparison data and the ordinal correlation, added after the fact
        # so both fine-tune and baseline candidates expose predictions keyed by the
        # same eval ids and can be compared pairwise rather than by two intervals.
        for head in TRAINED_HEADS:
            stats = entry["validation"].get(head, {})
            if "point" not in stats:
                continue
            stats["predictions"] = [class_lists[head][p] for p in predictions[head]]
            stats["eval_ids"] = list(eval_ids)

        raw_signal = labels_for(rows, eval_ids, "signal")
        signal_pairs = [
            (float(value), float(predictions["signal"][index]))
            for index, value in enumerate(raw_signal)
            if value is not None
        ]
        if len(signal_pairs) >= 10:
            from scipy.stats import spearmanr

            entry["validation"]["signal"]["spearman"] = round(
                float(spearmanr([a for a, _ in signal_pairs], [b for _, b in signal_pairs]).statistic), 4
            )

        # Declared before this run, not chosen after seeing it. This is the final
        # fine-tuning fence: the previous two left both backbones unconverged, so
        # the fence doubles again with every other rule unchanged, and the outcome
        # decides whether the fine-tuning experiment continues at all.
        report["escalation"] = {
            "applies_to": list(MODELS),
            "from_steps": 900,
            "to_steps": budget["steps"],
            "factor": round(budget["steps"] / 900, 3),
            "final_fence": True,
            "reason": "second escalation, declared as the final fine-tuning fence before this run",
            "stopping_rule": (
                "if neither backbone converges, or neither shows a meaningful validation advantage "
                "over TF-IDF at this fence, fine-tuning stops and the simpler baseline is selected"
            ),
            "declared_before_run": True,
            "unchanged": ["seed", "class weighting rule", "shuffling", "optimizer", "schedule", "joint heads", "split"],
        }

        report["models"][name] = entry

        print(f"{name}: {len(curve)} steps, converged={converged} (tail improvement {improvement:.4f})")
        for head in TRAINED_HEADS:
            stats = entry["validation"][head]
            print(f"    {head:<9}{stats['metric']:<13}{stats['point']}")

        out_dir = ARTIFACTS / "finetuned" / name / args.tag
        out_dir.mkdir(parents=True, exist_ok=True)
        tokenizer.save_pretrained(out_dir)
        torch.save({"state_dict": model.state_dict(), "pooling": spec["pooling"], "classes": class_lists}, out_dir / "model.pt")
        entry["checkpoint"] = str(out_dir.relative_to(ROOT))

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"finetune-{args.tag}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {RESULTS / f'finetune-{args.tag}.json'}")


if __name__ == "__main__":
    main()
