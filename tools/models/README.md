# Model tooling

Offline scripts for the local-classification experiment. Nothing here ships in
the app, and the app does not depend on any of it.

The TypeScript steps import the app's own functions on purpose. The canonical
input string and the classification vocabulary are defined once, in `src/lib/`,
and the dataset export reuses them rather than reproducing them. That is why
`tsx` is a dev dependency.

## Running it

```bash
pnpm models:taxonomy      # vocabulary -> artifacts/taxonomy.json
pnpm models:dataset       # snapshot -> artifacts/dataset.jsonl
pnpm models:audit         # -> results/phase0.json
pnpm models:sample        # stratified sample -> artifacts/label-audit-sample.jsonl
pnpm models:labels        # calls the teacher -> results/label-audit.json
```

`models:labels` spends real API calls. Check it first without spending any:

```bash
npx tsx scripts/models/audit-labels.ts --dry
npx tsx scripts/models/audit-labels.ts --limit 16
```

The remaining scripts are run directly with the venv interpreter, for example
`tools/models/.venv/bin/python tools/models/phase1_baselines.py`. Create the venv
with `python3 -m venv tools/models/.venv` and install numpy, scikit-learn,
onnxruntime, tokenizers, huggingface_hub, onnx, torch and transformers.

## What is committed

`results/` holds the reports and is committed. They are aggregates, and they are
the record of what was measured and what was decided.

`artifacts/` holds the database snapshots, the exported dataset and per-item
debug output. Those contain real item text, so they stay on this machine and are
gitignored. So is the venv.

## Layout

```
scripts/models/     TypeScript steps, because they need the app's own code
  export-taxonomy.ts
  export-dataset.ts
  audit-labels.ts
  relabel-corpus.ts
  heuristic-baseline.ts
tools/models/       Python steps, standard library plus numpy and scikit-learn
  audit_dataset.py
  sample_for_audit.py
  phase1_split.py
  phase1_baselines.py
  phase1_encoders.py
  phase1_finetune.py
  phase1_topic_ab.py
  parity_onnx.py
  quantize_onnx.py
  primary_local_model.py
  freeze_and_test.py
tools/notebooks/    scratch space; never the source of a number
```

## Where the numbers come from

The label audit imports `LLM_SYSTEM`, `buildLlmPrompt`, `LLM_CHUNK_SIZE`,
`llmEntryToRaw` and `finalize` from `src/lib/ai/classify.ts`. Change any of them
and the next audit measures the change, instead of quietly measuring a stale copy
of what the app used to do.
