/**
 * Re-labels a deliberately sampled corpus under a frozen contract.
 *
 * Three things this script exists to guarantee:
 *
 * 1. The contract is written down as an artifact, not a convention. The exact
 *    system prompt, prompt template hash, taxonomy version, canonical input
 *    version, model, temperature and batch size are recorded alongside the rows
 *    they produced, so a label can never again be orphaned from how it was made.
 * 2. Every row carries its own provenance: prompt version, taxonomy version,
 *    canonical input version, model, engine and labelling timestamp.
 * 3. The Phase 1 dataset is not touched. A new snapshot is taken, the output goes
 *    to a different file, and the existing dataset, splits and test lock are
 *    opened read-only. Test, validation and calibration ids are excluded from the
 *    new corpus by construction, so nothing here can contaminate an evaluation.
 *
 * Sampling targets coverage rather than volume. The unlabelled rows carry the
 * heuristic category and field from ingest, which is a usable proxy for classes
 * the current labels under-represent, so rare proxied cells are taken whole and
 * the remaining budget is filled across sources for diversity.
 *
 *   npx tsx scripts/models/relabel-corpus.ts --max 1200
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { CANONICAL_INPUT_VERSION, canonicalInputText } from "../../src/lib/ai/canonical";
import {
  buildLlmPrompt,
  finalize,
  LLM_CHUNK_SIZE,
  LLM_SYSTEM,
  llmEntryToRaw,
  type LlmClassificationEntry,
  type TeacherPromptItem,
} from "../../src/lib/ai/classify";
import { SIGNAL_LEVELS, TAXONOMY_VERSION } from "../../src/lib/ai/taxonomy";
import { parseJsonLoose } from "../../src/lib/utils";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifacts = join(root, "tools", "models", "artifacts");
const results = join(root, "tools", "models", "results");
const snapshotDir = join(artifacts, "snapshot-relabel");

const CORPUS = join(artifacts, "relabel-corpus.jsonl");
const CONTRACT = join(artifacts, "relabel-contract.json");
const COVERAGE = join(results, "relabel-coverage.json");

const SIGNAL_TOP = SIGNAL_LEVELS.length - 1;
const CONCURRENCY = 3;
// Cells the existing labels under-represent, by heuristic provenance. Taking
// these whole is what turns a larger corpus into broader coverage instead of a
// louder copy of the current distribution.
const RARE_FIELDS = new Set(["data", "security", "web_frontend", "systems_infra"]);
const RARE_CATEGORIES = new Set(["repo", "paper"]);

interface Row extends TeacherPromptItem {
  category: string;
  field: string;
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function defaultDatabasePath(): string {
  const identifier = "com.pulse.desktop";
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", identifier, "pulse.db");
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), identifier, "pulse.db");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), identifier, "pulse.db");
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/* -------------------------------------------------------------------------- */
/* The frozen contract                                                        */
/* -------------------------------------------------------------------------- */

function freezeContract(model: string, provider: string, chunkSize: number) {
  const header = buildLlmPrompt([]).split("\nItems:\n")[0];
  return {
    contract: "pulse-classification",
    version: "1",
    status: "frozen",
    frozenAt: new Date().toISOString(),
    taxonomyVersion: TAXONOMY_VERSION,
    canonicalInputVersion: CANONICAL_INPUT_VERSION,
    provider,
    model,
    temperature: 0.3,
    maxTokens: 1600,
    responseFormat: "json_object",
    chunkSize,
    systemPromptSha256: createHash("sha256").update(LLM_SYSTEM).digest("hex"),
    promptTemplateSha256: createHash("sha256").update(`${LLM_SYSTEM}\n${header}`).digest("hex"),
    validation: "every answer passes through finalize(), the same vocabulary validation production uses",
    note: "supersedes nothing: historical labels keep their own unknown provenance and are not rewritten",
  };
}

/* -------------------------------------------------------------------------- */
/* Teacher                                                                    */
/* -------------------------------------------------------------------------- */

function loadTeacher() {
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
    throw new Error(`This runner speaks OpenAI-compatible chat only, not provider "${provider}".`);
  }
  if (!url.startsWith("http") || !apiKey)
    throw new Error(`Provider "${provider}" is missing a base URL or API key.`);
  return { provider, model: String(task.model ?? ""), url, apiKey };
}

async function callTeacher(teacher: ReturnType<typeof loadTeacher>, items: TeacherPromptItem[]) {
  const body = {
    model: teacher.model,
    messages: [
      { role: "system", content: LLM_SYSTEM },
      { role: "user", content: buildLlmPrompt(items) },
    ],
    temperature: 0.3,
    max_tokens: 1600,
    response_format: { type: "json_object" },
  };
  let last = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(teacher.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${teacher.apiKey}` },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const value = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
      };
      return { text: value.choices?.[0]?.message?.content ?? "", model: value.model ?? teacher.model };
    }
    last = `${response.status} ${(await response.text()).slice(0, 160)}`;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
  }
  throw new Error(`Teacher call failed: ${last}`);
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const max = Number(arg("max", "1200"));
  const dbPath = arg("db", defaultDatabasePath());
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}.`);

  // A fresh snapshot in its own directory: the Phase 1 snapshot stays untouched.
  mkdirSync(snapshotDir, { recursive: true });
  const snapshot = join(snapshotDir, "pulse.db");
  copyFileSync(dbPath, snapshot);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${dbPath}${suffix}`)) copyFileSync(`${dbPath}${suffix}`, `${snapshot}${suffix}`);
  }

  const teacher = loadTeacher();
  const contract = freezeContract(teacher.model, teacher.provider, LLM_CHUNK_SIZE);
  writeFileSync(CONTRACT, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  // Read-only inputs: the Phase 1 dataset and split are never modified.
  const existing = readJsonl(join(artifacts, "dataset.jsonl"));
  const alreadyLabelled = new Set(existing.filter((row) => row.labelled).map((row) => String(row.id)));
  const splitIds = new Set<string>();
  const splitsPath = join(artifacts, "splits.json");
  if (existsSync(splitsPath)) {
    const splits = JSON.parse(readFileSync(splitsPath, "utf8")).splits as Record<string, string[]>;
    for (const name of ["test", "validation", "calibration"])
      for (const id of splits[name] ?? []) splitIds.add(id);
  }

  const db = new DatabaseSync(snapshot, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, title, source, url, author, body, category, field FROM items WHERE jev_at IS NULL OR jev_at IS ''`
    )
    .all() as unknown as Row[];
  db.close();

  const eligible = rows.filter(
    (row) => !alreadyLabelled.has(row.id) && !splitIds.has(row.id) && row.title.trim()
  );

  // Coverage-first selection: rare proxied cells whole, then diversity across
  // sources, so the corpus widens the class spread rather than just growing.
  const rare = eligible.filter((row) => RARE_FIELDS.has(row.field) || RARE_CATEGORIES.has(row.category));
  const rest = eligible.filter((row) => !rare.includes(row));
  const bySource = new Map<string, Row[]>();
  for (const row of rest) bySource.set(row.source, [...(bySource.get(row.source) ?? []), row]);

  const selected: Row[] = [...rare];
  const perSource = Math.max(1, Math.floor((max - selected.length) / Math.max(bySource.size, 1)));
  for (const [, group] of bySource) selected.push(...group.slice(0, perSource));
  for (const row of rest) {
    if (selected.length >= max) break;
    if (!selected.includes(row)) selected.push(row);
  }
  const corpus = selected.slice(0, max);

  console.log(
    `contract frozen: taxonomy ${contract.taxonomyVersion}, prompt ${contract.promptTemplateSha256.slice(0, 12)}`
  );
  console.log(`eligible unlabelled ${eligible.length}, rare-cell ${rare.length}, selected ${corpus.length}`);
  console.log(`excluded ${splitIds.size} ids held by validation, calibration or the test lock`);

  const labelledAt = new Date().toISOString();
  const out: string[] = [];
  const unresolved: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < corpus.length) {
      const batch = corpus.slice(cursor, cursor + LLM_CHUNK_SIZE);
      cursor += LLM_CHUNK_SIZE;
      try {
        const response = await callTeacher(teacher, batch);
        const parsed = parseJsonLoose<{ items?: LlmClassificationEntry[] }>(response.text);
        const entries = new Map((parsed?.items ?? []).filter((e) => e?.id).map((e) => [e.id as string, e]));
        for (const row of batch) {
          const entry = entries.get(row.id);
          if (!entry) {
            unresolved.push(row.id);
            continue;
          }
          // The same validation production uses, so a stored label here means
          // exactly what a stored label means in the app.
          const classification = finalize(row as never, llmEntryToRaw(entry), response.model, "relabel");
          out.push(
            JSON.stringify({
              id: row.id,
              input: canonicalInputText(row),
              labels: {
                category: classification.category,
                field: classification.field,
                topic: classification.topic,
                signalLevel:
                  classification.signal === null ? null : Math.round(classification.signal * SIGNAL_TOP),
                primary: classification.primarySource,
                whyKey: classification.whyKey,
              },
              provenance: {
                contractVersion: contract.version,
                promptVersion: contract.promptTemplateSha256,
                taxonomyVersion: contract.taxonomyVersion,
                canonicalInputVersion: contract.canonicalInputVersion,
                engine: teacher.provider,
                model: response.model,
                labelledAt,
                source: "relabel-corpus",
              },
              meta: { source: row.source, category: row.category, field: row.field },
            })
          );
        }
      } catch (error) {
        unresolved.push(...batch.map((row) => row.id));
        console.error(`batch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      process.stdout.write(".");
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  mkdirSync(artifacts, { recursive: true });
  writeFileSync(CORPUS, `${out.join("\n")}\n`, "utf8");

  // Measured coverage, not intended coverage: the old labels next to the new.
  const rowsById = new Map(corpus.map((row) => [row.id, row]));
  const oldCounts = new Map<string, Map<string, number>>();
  for (const row of existing) {
    if (!row.labelled) continue;
    const labels = row.labels as Record<string, unknown>;
    for (const [head, key] of Object.entries({
      category: "category",
      field: "field",
      topic: "topic",
      signalLevel: "signalLevel",
      primary: "primary",
      whyKey: "whyKey",
    })) {
      const value = String(labels?.[key] ?? "null");
      const bucket = oldCounts.get(head) ?? new Map<string, number>();
      bucket.set(value, (bucket.get(value) ?? 0) + 1);
      oldCounts.set(head, bucket);
    }
  }
  const newCounts = new Map<string, Map<string, number>>();
  for (const line of out) {
    const parsed = JSON.parse(line) as { labels: Record<string, unknown> };
    for (const [head, value] of Object.entries(parsed.labels)) {
      const bucket = newCounts.get(head) ?? new Map<string, number>();
      const key = String(value ?? "null");
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
      newCounts.set(head, bucket);
    }
  }

  const coverage: Record<string, unknown> = {};
  for (const head of new Set([...oldCounts.keys(), ...newCounts.keys()])) {
    const before = oldCounts.get(head) ?? new Map();
    const added = newCounts.get(head) ?? new Map();
    const recovered = [...added.keys()].filter((value) => !before.has(value) && value !== "null");
    coverage[head] = {
      classes_before: before.size,
      classes_added_by_new_corpus: recovered,
      before_counts: Object.fromEntries(before),
      added_counts: Object.fromEntries(added),
    };
  }

  const report = {
    ranAt: new Date().toISOString(),
    contract,
    snapshot: { path: snapshot, takenAt: statSync(snapshot).mtime.toISOString() },
    selection: {
      rule: "rare proxied cells whole, then a per-source quota, then fill to the cap",
      rare_fields: [...RARE_FIELDS],
      rare_categories: [...RARE_CATEGORIES],
      eligible: eligible.length,
      rare_cell: rare.length,
      selected: corpus.length,
      excluded_split_ids: splitIds.size,
    },
    new_rows: out.length,
    rows_without_an_answer: unresolved.length,
    phase1_dataset_untouched: true,
    coverage,
  };
  mkdirSync(results, { recursive: true });
  writeFileSync(COVERAGE, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`\n\nlabelled ${out.length} new rows, ${unresolved.length} without an answer`);
  for (const [head, stats] of Object.entries(coverage)) {
    const typed = stats as {
      classes_before: number;
      before_counts: Record<string, number>;
      added_counts: Record<string, number>;
    };
    const after = new Set([...Object.keys(typed.before_counts), ...Object.keys(typed.added_counts)]);
    console.log(`  ${head.padEnd(12)} classes ${typed.classes_before} -> ${after.size}`);
  }
  console.log(`wrote ${CORPUS}`);
  console.log(`wrote ${COVERAGE}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
