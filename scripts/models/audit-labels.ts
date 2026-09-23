/**
 * Label consistency audit.
 *
 * Re-runs the configured teacher over a sample of already-labelled items and
 * measures how much the answers agree with what production stored. The stored
 * labels are supervision data, not ground truth, so this measures consistency
 * and noise rather than correctness.
 *
 * It reuses the production pieces rather than copying them: `LLM_SYSTEM`,
 * `buildLlmPrompt`, `LLM_CHUNK_SIZE`, `llmEntryToRaw` and `finalize`. Anything
 * the app changes in those shows up here on the next run, including fallbacks.
 *
 * The teacher configuration is frozen into the output before the first call, so
 * a stored label is never compared against a moving target.
 *
 *   npx tsx scripts/models/audit-labels.ts --dry
 *   npx tsx scripts/models/audit-labels.ts --limit 16
 *   npx tsx scripts/models/audit-labels.ts
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  buildLlmPrompt,
  finalize,
  LLM_CHUNK_SIZE,
  LLM_SYSTEM,
  llmEntryToRaw,
  type LlmClassificationEntry,
  type TeacherPromptItem,
} from "../../src/lib/ai/classify";
import { SIGNAL_LEVELS } from "../../src/lib/ai/taxonomy";
import { parseJsonLoose } from "../../src/lib/utils";

const HEADS = ["category", "field", "topic", "signal", "primary", "whyKey"] as const;
const REPEAT_SUBSET = 40;
const REPEATS = 3;
// The configured provider rejects more than three concurrent requests for this
// model ("3/3 slots in use"), and production classifies sequentially, so the
// audit stays at the limit rather than provoking rate-limit errors.
const CONCURRENCY = 3;
const SIGNAL_TOP = SIGNAL_LEVELS.length - 1;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifacts = join(root, "tools", "models", "artifacts");
const resultsDir = join(root, "tools", "models", "results");

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

/* -------------------------------------------------------------------------- */
/* Frozen teacher configuration                                               */
/* -------------------------------------------------------------------------- */

interface TeacherConfig {
  provider: string;
  model: string;
  url: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  responseFormat: string;
  system: string;
  chunkSize: number;
  promptVersion: string;
}

function promptVersion(): string {
  // The header of the production prompt plus the system message, hashed. The
  // item payload is excluded because it varies per call.
  const header = buildLlmPrompt([]).split("\nItems:\n")[0];
  return createHash("sha256").update(`${LLM_SYSTEM}\n${header}`).digest("hex").slice(0, 16);
}

function loadTeacherConfig(): TeacherConfig {
  const path = join(homedir(), ".pulse", "config.json");
  if (!existsSync(path)) throw new Error(`No app config at ${path}.`);
  const config = JSON.parse(readFileSync(path, "utf8"));
  const task = config.classification ?? {};
  const provider = String(task.provider ?? "");

  let url: string;
  let apiKey: string;
  if (provider === "openai-compatible") {
    const section = config.openaiCompatible ?? {};
    url = `${String(section.baseUrl ?? "").replace(/\/+$/, "")}/chat/completions`;
    apiKey = String(section.apiKey ?? "");
  } else if (provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    apiKey = String(config.openrouter?.apiKey ?? "");
  } else {
    // Cloudflare's System One endpoint is a different shape; the audit refuses
    // rather than silently measuring a contract the app does not use.
    throw new Error(`The audit speaks OpenAI-compatible chat only, not provider "${provider}".`);
  }

  if (!url.startsWith("http") || !apiKey) {
    throw new Error(`Provider "${provider}" is missing a base URL or an API key in ~/.pulse/config.json.`);
  }

  return {
    provider,
    model: String(task.model ?? ""),
    url,
    apiKey,
    temperature: 0.3,
    maxTokens: 1600,
    responseFormat: "json_object",
    system: LLM_SYSTEM,
    chunkSize: LLM_CHUNK_SIZE,
    promptVersion: promptVersion(),
  };
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

interface SampleRow {
  id: string;
  labels: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

interface ItemRow extends TeacherPromptItem {
  category: string;
  field: string;
}

function readSample(limit?: number): SampleRow[] {
  const path = join(artifacts, "label-audit-sample.jsonl");
  if (!existsSync(path)) {
    throw new Error(`No sample at ${path}. Run: python3 tools/models/sample_for_audit.py`);
  }
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as SampleRow);
  return limit ? rows.slice(0, limit) : rows;
}

/**
 * Items are read from the snapshot the dataset export took, so the prompt is
 * built from the same columns production uses and the live database is untouched.
 */
function readItems(ids: string[]): Map<string, ItemRow> {
  const snapshot = join(artifacts, "snapshot", "pulse.db");
  if (!existsSync(snapshot)) {
    throw new Error(`No snapshot at ${snapshot}. Run: npx tsx scripts/models/export-dataset.ts`);
  }
  const db = new DatabaseSync(snapshot, { readOnly: true });
  const statement = db.prepare(
    `SELECT id, title, source, url, author, body, category, field FROM items WHERE id = ?`
  );
  const found = new Map<string, ItemRow>();
  for (const id of ids) {
    const row = statement.get(id) as unknown as ItemRow | undefined;
    if (row) found.set(id, row);
  }
  db.close();
  return found;
}

/* -------------------------------------------------------------------------- */
/* Teacher call                                                               */
/* -------------------------------------------------------------------------- */

async function callTeacher(
  config: TeacherConfig,
  items: TeacherPromptItem[]
): Promise<{ text: string; model?: string }> {
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: config.system },
      { role: "user", content: buildLlmPrompt(items) },
    ],
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    response_format: { type: config.responseFormat },
  };

  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const value = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
      };
      return { text: value.choices?.[0]?.message?.content ?? "", model: value.model };
    }
    lastError = `${response.status} ${(await response.text()).slice(0, 200)}`;
    if (response.status !== 429 && response.status < 500) break;
    // Longer than a typical rate-limit window, because the provider counts
    // concurrent slots rather than requests per minute.
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
  }
  throw new Error(`Teacher call failed: ${lastError}`);
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                 */
/* -------------------------------------------------------------------------- */

function observeType(value: unknown): string {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "float";
  return typeof value;
}

function asLevel(signal: unknown): number | null {
  if (typeof signal !== "number" || Number.isNaN(signal)) return null;
  return Math.round(signal * SIGNAL_TOP);
}

/** What the app would have stored, so both sides are comparable. */
function regeneratedLabels(item: ItemRow, entry: LlmClassificationEntry, model: string) {
  const classification = finalize(item as never, llmEntryToRaw(entry), model, "audit");
  return {
    category: classification.category,
    field: classification.field,
    topic: classification.topic,
    signal: asLevel(classification.signal),
    primary: classification.primarySource,
    whyKey: classification.whyKey,
  };
}

function storedLabels(row: SampleRow) {
  // The dataset stores `signalLevel` already as a 0 to 3 level, while
  // `finalize` returns 0 to 1. The two sides are scaled once each, not twice.
  return {
    category: row.labels.category ?? null,
    field: row.labels.field ?? null,
    topic: row.labels.topic ?? null,
    signal: typeof row.labels.signalLevel === "number" ? row.labels.signalLevel : null,
    primary: row.labels.primary ?? null,
    whyKey: row.labels.whyKey ?? null,
  };
}

interface Comparison {
  id: string;
  stored: Record<string, unknown>;
  regenerated: Record<string, unknown>;
  rawTypes: Record<string, string>;
}

function compare(row: SampleRow, item: ItemRow, entry: LlmClassificationEntry, model: string): Comparison {
  return {
    id: row.id,
    stored: storedLabels(row),
    regenerated: regeneratedLabels(item, entry, model),
    rawTypes: {
      category: observeType(entry.category),
      field: observeType(entry.field),
      topic: observeType(entry.topic),
      signal: observeType(entry.signal),
      primary: observeType(entry.primary),
      whyKey: observeType(entry.whyKey),
    },
  };
}

function agreement(comparisons: Comparison[]): Record<string, unknown> {
  const report: Record<string, unknown> = {};
  for (const head of HEADS) {
    // An entry can come back carrying only an id. Those rows are the teacher
    // not answering, so they are counted separately rather than scored as a
    // wrong answer, which would blame the teacher for a fallback it never saw.
    const answered = (row: Comparison) => row.rawTypes[head] !== "absent" && row.rawTypes[head] !== "null";
    const pairs = comparisons.filter(
      (row) => row.stored[head] !== null && row.stored[head] !== undefined && answered(row)
    );
    const agree = pairs.filter((row) => row.stored[head] === row.regenerated[head]).length;
    const matrix: Record<string, number> = {};
    for (const row of pairs) {
      const key = `${String(row.stored[head])} -> ${String(row.regenerated[head])}`;
      matrix[key] = (matrix[key] ?? 0) + 1;
    }
    const disagreements = Object.entries(matrix)
      .filter(([key]) => key.split(" -> ")[0] !== key.split(" -> ")[1])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const rawTypes: Record<string, number> = {};
    for (const row of comparisons) rawTypes[row.rawTypes[head]] = (rawTypes[row.rawTypes[head]] ?? 0) + 1;

    report[head] = {
      compared: pairs.length,
      agreed: agree,
      agreement: pairs.length ? round(agree / pairs.length) : null,
      unanswered: comparisons.length - pairs.filter((row) => answered(row)).length,
      regenerated_missing: comparisons.filter(
        (row) => row.regenerated[head] === null || row.regenerated[head] === undefined
      ).length,
      raw_types_observed: rawTypes,
      top_disagreements: Object.fromEntries(disagreements),
    };
  }
  return report;
}

const round = (value: number): number => Math.round(value * 10000) / 10000;

/** One batch through the teacher, mapped and compared with what is stored. */
async function classifyRows(
  config: TeacherConfig,
  batch: SampleRow[],
  items: Map<string, ItemRow>
): Promise<{ comparisons: Comparison[]; unparsed: number }> {
  const response = await callTeacher(
    config,
    batch.map((row) => items.get(row.id) as ItemRow)
  );
  const parsed = parseJsonLoose<{ items?: LlmClassificationEntry[] }>(response.text);
  const entries = new Map(
    (parsed?.items ?? []).filter((entry) => entry?.id).map((entry) => [entry.id as string, entry])
  );

  const comparisons: Comparison[] = [];
  let unparsed = 0;
  for (const row of batch) {
    const entry = entries.get(row.id);
    if (!entry) {
      unparsed += 1;
      continue;
    }
    comparisons.push(compare(row, items.get(row.id) as ItemRow, entry, response.model ?? config.model));
  }
  process.stdout.write(unparsed ? "!" : ".");
  return { comparisons, unparsed };
}

async function inBatches<T, R>(items: T[], size: number, work: (batch: T[]) => Promise<R>): Promise<R[]> {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));

  const out: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
    while (cursor < batches.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await work(batches[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const config = loadTeacherConfig();
  const sample = readSample(Number(arg("limit", "0")) || undefined);
  const items = readItems(sample.map((row) => row.id));

  const usable = sample.filter((row) => items.has(row.id));
  if (usable.length === 0) throw new Error("None of the sampled ids are in the snapshot.");

  const frozen = {
    provider: config.provider,
    model: config.model,
    endpoint_host: new URL(config.url).host,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    response_format: config.responseFormat,
    system_prompt_sha: createHash("sha256").update(config.system).digest("hex").slice(0, 16),
    prompt_version: config.promptVersion,
    chunk_size: config.chunkSize,
    taxonomy_signal_levels: SIGNAL_LEVELS.length,
  };

  if (hasFlag("dry")) {
    const batch = usable.slice(0, config.chunkSize);
    console.log(JSON.stringify(frozen, null, 2));
    console.log(`\nfirst batch of ${batch.length}:\n`);
    console.log(buildLlmPrompt(batch.map((row) => items.get(row.id) as ItemRow)));
    console.log("\ndry run: no teacher calls made");
    return;
  }

  console.log(`auditing ${usable.length} items against ${config.provider}/${config.model}`);
  const batches = await inBatches(usable, config.chunkSize, (batch) => classifyRows(config, batch, items));

  const comparisons = batches.flatMap((batch) => batch.comparisons);
  const unparsed = batches.reduce((total, batch) => total + batch.unparsed, 0);

  const subset = usable.slice(0, Math.min(REPEAT_SUBSET, usable.length));
  const repeats: Comparison[][] = [];
  for (let run = 0; run < REPEATS; run += 1) {
    const batchesOut = await inBatches(subset, config.chunkSize, (batch) =>
      classifyRows(config, batch, items)
    );
    repeats.push(batchesOut.flatMap((batch) => batch.comparisons));
  }

  const selfConsistency: Record<string, unknown> = {};
  for (const head of HEADS) {
    let pairs = 0;
    let stable = 0;
    const first = new Map(repeats[0].map((row) => [row.id, row]));
    for (const later of repeats.slice(1)) {
      for (const row of later) {
        const base = first.get(row.id);
        if (!base) continue;
        pairs += 1;
        if (base.regenerated[head] === row.regenerated[head]) stable += 1;
      }
    }
    selfConsistency[head] = { pairs, stable, rate: pairs ? round(stable / pairs) : null };
  }

  // How much of the disagreement is the teacher disagreeing with itself when a
  // batch changes. Same items, same prompt, different neighbours.
  const probeRows = usable.slice(0, config.chunkSize);
  const asBatch = await classifyRows(config, probeRows, items);
  const asSingles = (await inBatches(probeRows, 1, (batch) => classifyRows(config, batch, items))).flatMap(
    (batch) => batch.comparisons
  );
  const singlesById = new Map(asSingles.map((row) => [row.id, row]));
  const batchContext: Record<string, unknown> = {};
  for (const head of HEADS) {
    let pairs = 0;
    let same = 0;
    for (const row of asBatch.comparisons) {
      const single = singlesById.get(row.id);
      if (!single) continue;
      pairs += 1;
      if (row.regenerated[head] === single.regenerated[head]) same += 1;
    }
    batchContext[head] = { pairs, same, rate: pairs ? round(same / pairs) : null };
  }

  const meta = existsSync(join(artifacts, "dataset.meta.json"))
    ? JSON.parse(readFileSync(join(artifacts, "dataset.meta.json"), "utf8"))
    : {};
  const sampleMeta = existsSync(join(artifacts, "label-audit-sample.meta.json"))
    ? JSON.parse(readFileSync(join(artifacts, "label-audit-sample.meta.json"), "utf8"))
    : {};

  const report = {
    phase: "0 label consistency audit",
    ranAt: new Date().toISOString(),
    teacher: frozen,
    dataset: meta,
    sample: sampleMeta,
    items_compared: comparisons.length,
    responses_without_usable_entries: unparsed,
    agreement: agreement(comparisons),
    self_consistency: { repeats: REPEATS, subset: subset.length, per_head: selfConsistency },
    batch_context: { items: probeRows.length, per_head: batchContext },
  };

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, "label-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    join(artifacts, "label-audit-detail.jsonl"),
    `${comparisons.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8"
  );

  console.log("\n");
  console.log(`compared ${comparisons.length} items, ${unparsed} without usable entries`);
  console.log(
    `${"head".padEnd(9)}${"agree".padStart(8)}${"of".padStart(7)}${"rate".padStart(9)}   raw types`
  );
  for (const head of HEADS) {
    const stats = report.agreement[head] as Record<string, unknown>;
    console.log(
      `${head.padEnd(9)}${String(stats.agreed).padStart(8)}${String(stats.compared).padStart(7)}` +
        `${String(stats.agreement).padStart(9)}   ${JSON.stringify(stats.raw_types_observed)}`
    );
  }
  console.log("\nself-consistency over the first", subset.length, "items,", REPEATS, "runs:");
  for (const head of HEADS) console.log(`  ${head.padEnd(9)} ${JSON.stringify(selfConsistency[head])}`);
  console.log(`\nbatch context probe: ${probeRows.length} items as one batch vs as singletons`);
  for (const head of HEADS) console.log(`  ${head.padEnd(9)} ${JSON.stringify(batchContext[head])}`);
  console.log(`\nwrote ${join(resultsDir, "label-audit.json")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
