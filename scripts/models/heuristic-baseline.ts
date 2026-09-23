/**
 * The deterministic heuristic's predictions for the contract-v1 validation split.
 *
 * `heuristicClassify` is the applicable baseline for category and field, and for
 * nothing else: it produces no topic, signal, primary or whyKey prediction. Those
 * heads are judged against the prior alone. Running it here rather than
 * reimplementing it means the baseline is the app's own rules.
 *
 * Predictions only. Scoring happens in Python so every candidate is measured by
 * one metric implementation.
 *
 *   npx tsx scripts/models/heuristic-baseline.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { heuristicClassify } from "../../src/lib/classify/heuristic";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifacts = join(root, "tools", "models", "artifacts");

const splitsPath = join(artifacts, "contract1-splits.json");
const snapshot = join(artifacts, "snapshot-relabel", "pulse.db");
const out = join(artifacts, "heuristic-contract1.jsonl");

if (!existsSync(splitsPath)) throw new Error(`No split at ${splitsPath}. Run contract1_split.py first.`);
if (!existsSync(snapshot)) throw new Error(`No snapshot at ${snapshot}.`);

const splits = JSON.parse(readFileSync(splitsPath, "utf8")).splits as Record<string, string[]>;
const ids = splits.validation;

const db = new DatabaseSync(snapshot, { readOnly: true });
const statement = db.prepare(`SELECT id, title, url, body, source, source_type FROM items WHERE id = ?`);

const lines: string[] = [];
for (const id of ids) {
  const row = statement.get(id) as
    | { id: string; title: string; url: string; body: string | null; source: string; source_type: string }
    | undefined;
  if (!row) continue;
  // Only the fields the heuristic reads: title, body, url and source.
  const verdict = heuristicClassify({
    id: row.id,
    title: row.title,
    body: row.body,
    url: row.url,
    source: row.source,
    sourceType: row.source_type,
  } as never);
  lines.push(JSON.stringify({ id: row.id, category: verdict.category, field: verdict.field }));
}
db.close();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
console.log(`heuristic predictions for ${lines.length} validation items, wrote ${out}`);
