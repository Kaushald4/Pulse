# Phase 0: dataset audit, label consistency, and the invalidation fix

Read from a snapshot copy of the app database, never the live file. Machine
readable results: `results/phase0.json`, `results/label-audit.json`.

Snapshot: 1708 rows, 674 labelled, taken 2026-09-22. Taxonomy version 1,
canonical input version 1.

## 1. What the data looks like

| Fact | Value |
| --- | --- |
| Items | 1708 |
| Labelled | 674 (39 percent) |
| Unlabelled | 1034 |
| Labelled with any body text | 153 (23 percent of labelled) |
| Content changed since classification | 0 |
| Label engines | 1 (`deepseek-v4-flash` on all 674) |
| Distinct canonical URLs | 1612 for 1708 rows |
| Rows in multi item groups | 184 |
| Title collisions | 120 |

Vocabulary, measured rather than assumed: 4 categories, 7 fields, 16 topics, 4
ordinal signal levels, 2 primary values, 7 whyKey values.

Class spread, and the imbalance that decides what can be concluded:

| Head | Majority class | Majority share | Classes seen | Imbalance |
| --- | --- | --- | --- | --- |
| category | news 446 | 0.66 | 4 of 4 | 8.0 |
| field | developer_tools 370 | 0.55 | 7 of 7 | 52.9 |
| topic | other 285 | 0.42 | 15 of 16 | 47.5 |
| signal | level 1 | 0.39 | 4 of 4 | 12.7 |
| primary | false 334 | 0.57 | 2 of 2 | 1.3 |
| whyKey | other 372 | 0.55 | 7 of 7 | 24.8 |

Two classes cannot support a conclusion at all: `open-source` has 6 items and
`networking-distributed` has 9. The sample includes every one of them, and that
is still too few. This is reported rather than smoothed over.

The body text matters more than expected: 521 of 674 labelled items have no
excerpt, so most supervision is title plus source plus URL. Any head that looks
like it needs prose has less evidence than the prompt implies.

## 2. Label consistency audit

Frozen teacher configuration, recorded before the first call: provider
`openai-compatible`, model `deepseek-v4-flash`, temperature 0.3, max_tokens 1600,
`response_format: json_object`, chunk size 8, taxonomy version 1, prompt version
`b863e17af0ff0dd9`. 400 items, stratified on topic with a floor of 12 per class,
seed 20260922.

The audit reuses the production pieces rather than copies of them: `LLM_SYSTEM`,
`buildLlmPrompt`, `LLM_CHUNK_SIZE`, `llmEntryToRaw` and `finalize`. Agreement is
therefore "would the app store the same value", including the same fallbacks.

| Head | Agreement with stored | Prior on the same sample | Above prior |
| --- | --- | --- | --- |
| category | 0.5608 | 0.6525 | **no** |
| field | 0.4365 | 0.5325 | **no** |
| topic | 0.6825 | 0.3400 | yes, +34 points |
| signal | 0.7463 | 0.4197 | yes, +33 points |
| primary | 0.8955 | 0.5718 | yes, +32 points |
| whyKey | 0.7910 | 0.5175 | yes, +27 points |

Self-consistency, same 40 items in three separate runs: 0.925 to 0.975 for every
head except signal at 0.8625. So the teacher is stable *with itself*, and the gap
against stored labels is not run-to-run noise.

Batch composition probe, the same 8 items sent as one batch and then as 8 single
item requests: category 0.875, field 0.875, topic 0.750, signal 0.625, primary
0.625, whyKey 0.750. Neighbours move an answer, so some of every agreement figure
above is batched-context sensitivity rather than a label error.

22 of 400 items came back as an object carrying only an id, with no field values
at all. Those are counted as unanswered, not as wrong answers.

**The disagreements are systematic, not diffuse.** The largest single patterns:

| Head | Pattern | Count |
| --- | --- | --- |
| category | news -> resource | 134 |
| field | developer_tools -> other | 55 |
| field | developer_tools -> ai_ml | 62 |
| signal | 1 -> 2 | 35 |
| primary | true -> false | 20 |
| whyKey | other -> community-debate | 21 |

A one-directional shift of 134 items on category, and 117 items moving off
`developer_tools`, is a contract difference rather than ambiguity. The stored
labels were written by an earlier prompt, or an earlier version of the model,
under a definition this teacher no longer agrees with. Self-consistency at 0.93
and above for category means today's teacher would repeat today's answer.

## 3. What changed

**Taxonomy is now one source of truth.** `src/lib/ai/taxonomy.ts` declares the
vocabulary, the head kinds (signal is `score`, not `choice`, so it is ordinal by
construction) and the head cardinalities. `classify.ts` imports it instead of
declaring its own, `llm.ts` imports the labels from it, `scripts/models/export-taxonomy.ts`
emits `taxonomy.json` for the trainer, and `taxonomy.test.ts` fails if the export
stops matching what `finalize` accepts. That test also asserts the fallback
values `finalize` substitutes are inside the vocabulary, so our own fallbacks
cannot be off-vocabulary.

**One canonical input function.** `src/lib/ai/canonical.ts` renders an item as
labelled lines from the same fields the teacher payload uses, truncating at the
same 600 characters. The exported dataset stores the finished string, so Python
never rebuilds the layout and Rust will only tokenize it. `canonical.test.ts`
pins the exact layout, proves absent fields are omitted, proves the item id is
never included, and checks the truncation length.

**Dataset export with provenance.** `scripts/models/export-dataset.ts` reads a
copy of the database and writes `dataset.jsonl` with the canonical text, the
labels, and per row: label engine, label timestamp, confidence, the stored hash,
the current hash and whether they differ. Historical labels from different
contracts are therefore separable rather than silently mixed.

**Content hash invalidation fixed.** `needsClassification` is now: no label, or
no hash, or the stored hash differs from the current one, computed with the same
`hashContent(title, url, body)` the classifier uses.

This is deliberately not what the plan sketched. The plan said upsert should
refresh the hash on conflict, but reading the code shows `content_hash` belongs
to the classification, not the item: it records which content a label was written
from. Overwriting it at ingest would destroy exactly the provenance the dataset
export now preserves. So the comparison happens at read time and nothing is
overwritten, which also means no existing row is mutated by this change.

The scan reads all rows rather than narrowing in SQL, because the current hash is
computed in JavaScript. At 1708 rows that is a few milliseconds. The comment in
the code says the fix if that ever matters is a fingerprint written at ingest,
never a narrower query, which would silently skip changed rows.

**Two tooling problems found and fixed.**

`pnpm-workspace.yaml` contained a literal placeholder, `esbuild: set this to true
or false`, under `allowBuilds`. pnpm 11 refuses to install with an undecided build
script, so `pnpm install` exited non-zero, and because pnpm runs a dependency
check before every script, *every* command failed with an internal error,
including `pnpm test` and `pnpm typecheck`. Setting the value to `true` fixed it.
This was pre-existing and unrelated to this work, and it would have broken the
release pipeline too.

`@types/node` was pinned to 20, which has no `node:sqlite` types, so the export
tooling could not typecheck. Bumped to 24 to match the runtime.

`tsx` was added as a dev dependency so repo tooling can import the app's own
TypeScript instead of reimplementing the canonical input. It is dev only and does
not enter the app bundle.

Exports added for reuse with no behaviour change: `finalize`, `buildLlmPrompt`,
`LLM_SYSTEM`, `LLM_CHUNK_SIZE`, `llmEntryToRaw`, and the entry type. The LLM
path's answer mapping is now a named function the audit calls, so the audit
measures the production mapping rather than a copy.

## 4. What this implies

**The answer is per head, and it is not the one the plan guessed.** Phase 0 was
explicitly forbidden from pre-assigning heads, and the measurement earns that
rule:

- **topic, signal, primary, whyKey carry real learnable signal.** Agreement sits
  27 to 33 points above a constant predictor, self-consistency is 0.86 or better,
  and the disagreements are diffuse rather than one-directional. These are the
  heads Phase 1 should benchmark.
- **category and field do not.** Both agree with stored labels *less* often than
  simply predicting the majority class would, which means the stored labels for
  those two heads are not a target a model can learn toward. No amount of encoder
  tuning fixes that, and it would be dishonest to report it as a modelling
  failure.

The cause is contract drift, not noise, and it is fixable at the data level
rather than the model level. The highest leverage next step, if category and
field are wanted locally, is to re-label a corpus under the now-frozen contract
and record the prompt and taxonomy version on every label, so drift cannot happen
silently again. Today's schema records which model answered but not which prompt,
so an earlier prompt change is invisible after the fact.

This also matters beyond the model work: category and field drive the feed
filters, the today view tallies and the heuristic fallbacks, so their labels being
weaker than a constant predictor is a product finding in its own right.

## 5. Limitations

- Agreement is measured on a 400 item sample, which is 59 percent of all 674
  labelled items, so the sample and the training population overlap heavily. Phase
  1 must respect the split rather than treating this sample as held out.
- Baselines are computed on the sample itself, so the comparison is like for like.
  The population priors differ slightly.
- Batch composition moves topic and signal by 25 to 38 percent at 8 items. Every
  agreement figure carries that caveat.
- Self-consistency used 40 items and three runs, so its confidence intervals are
  wide.
- Two topic classes are too small to conclude anything about.
- 22 of 400 items got no teacher answer. Production would leave those items
  unlabelled, which is a robustness gap worth its own look.
- The audit made about 148 calls: two full runs, because the first sample was
  ordered by id and ids carry the source prefix, which put every arXiv item in the
  same request. That is a flaw in my first run, not in the provider.
- The provider enforces 3 concurrent requests for this model. Production
  classifies sequentially and never hits it; the audit now caps at 3 too.
- `signal` is stored as 0 to 1 and levels are 0 to 3. My first comparison scaled
  both sides and produced impossible level values, which is how the bug was
  caught. The two sides are now each scaled exactly once.
- Nothing here says whether a 22M encoder can reach these heads. That is Phase 1.

## 6. Why this phase was worth doing first

Two of the four heads that looked easy are unlearnable on the current labels, and
the reason is a data contract problem that no experiment in Phase 1 or 2 would
have revealed. Had the heads been pre-assigned as the plan's first draft proposed,
the project would have spent training effort on two heads whose labels are worse
than a constant predictor, and reported the result as a small-model failure.
