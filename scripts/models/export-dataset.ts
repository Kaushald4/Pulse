/**
 * Exports the classified items as a dataset for the offline trainer.
 *
 * Three rules this script exists to enforce:
 *
 * 1. It reads a copy of the app database, never the live file, and records which
 *    snapshot it read so a report can name its input.
 * 2. The input text comes from the app's own `canonicalInputText`, so Python and
 *    Rust never rebuild the layout and training input matches inference input.
 * 3. The content hash comes from the app's own `hashContent`, called with the
 *    same three arguments the classifier uses, so "content changed since
 *    classification" means the same thing here as it does in the app.
 *
 * Every item is exported, labelled or not, with a `labelled` flag, so the dataset
 * audit can count what is usable without re-querying the database.
 *
 *   npx tsx scripts/models/export-dataset.ts [--db <path>] [--out <path>]
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { CANONICAL_INPUT_VERSION, canonicalInputText } from "../../src/lib/ai/canonical";
import { SIGNAL_LEVELS, TAXONOMY_VERSION } from "../../src/lib/ai/taxonomy";
import { hashContent } from "../../src/lib/utils";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifacts = join(root, "tools", "models", "artifacts");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Where Tauri keeps the app database, per platform. Override with --db. */
function defaultDatabasePath(): string {
  const identifier = "com.pulse.desktop";
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", identifier, "pulse.db");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, identifier, "pulse.db");
  }
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, identifier, "pulse.db");
}

interface ItemRow {
  id: string;
  source: string;
  source_type: string;
  title: string;
  url: string;
  body: string | null;
  author: string | null;
  score: number | null;
  comments_count: number | null;
  published_at: string | null;
  created_at: string | null;
  state: string | null;
  canonical_url: string | null;
  category: string | null;
  field: string | null;
  topic: string | null;
  signal: number | null;
  primary_source: number | null;
  why_key: string | null;
  jev_model: string | null;
  jev_confidence: number | null;
  jev_at: string | null;
  content_hash: string | null;
}

const SIGNAL_TOP_LEVEL = SIGNAL_LEVELS.length - 1;

/**
 * The stored signal is a 0 to 1 number. Training needs the ordinal level it came
 * from, so it is converted back with the same denominator `finalize` divides by.
 */
function signalLevel(signal: number | null): number | null {
  if (typeof signal !== "number" || Number.isNaN(signal)) return null;
  const level = Math.round(signal * SIGNAL_TOP_LEVEL);
  return Math.max(0, Math.min(SIGNAL_TOP_LEVEL, level));
}

function main(): void {
  const source = arg("db") ?? defaultDatabasePath();
  if (!existsSync(source)) {
    console.error(`No database at ${source}. Pass --db <path> if it lives elsewhere.`);
    process.exit(1);
  }

  // Copy the database and its write-ahead log before reading, so the export is a
  // stable snapshot and the live file is never opened by this tool.
  const snapshotDir = join(artifacts, "snapshot");
  mkdirSync(snapshotDir, { recursive: true });
  const snapshot = join(snapshotDir, "pulse.db");
  copyFileSync(source, snapshot);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${source}${suffix}`)) copyFileSync(`${source}${suffix}`, `${snapshot}${suffix}`);
  }

  const db = new DatabaseSync(snapshot, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, source, source_type, title, url, body, author, score, comments_count,
              published_at, created_at, state, canonical_url, category, field, topic, signal,
              primary_source, why_key, jev_model, jev_confidence, jev_at, content_hash
       FROM items
       ORDER BY published_at DESC, id`
    )
    .all() as unknown as ItemRow[];
  db.close();

  const lines: string[] = [];
  let labelled = 0;
  let changed = 0;

  for (const row of rows) {
    const currentHash = hashContent(row.title, row.url, row.body);
    const isLabelled = row.jev_at !== null && row.jev_at !== undefined;
    if (isLabelled) labelled += 1;
    // Only meaningful when a classification stored a hash and the text moved on.
    const contentChanged = Boolean(row.content_hash) && row.content_hash !== currentHash;
    if (contentChanged) changed += 1;

    lines.push(
      JSON.stringify({
        id: row.id,
        labelled: isLabelled,
        input: canonicalInputText({
          title: row.title,
          source: row.source,
          url: row.url,
          author: row.author,
          body: row.body,
        }),
        labels: isLabelled
          ? {
              category: row.category,
              field: row.field,
              topic: row.topic,
              signalLevel: signalLevel(row.signal),
              primary: row.primary_source === null ? null : row.primary_source === 1,
              whyKey: row.why_key,
            }
          : null,
        provenance: {
          engine: row.jev_model,
          labelledAt: row.jev_at,
          confidence: row.jev_confidence,
          storedContentHash: row.content_hash,
          currentContentHash: currentHash,
          contentChanged,
        },
        meta: {
          source: row.source,
          sourceType: row.source_type,
          publishedAt: row.published_at,
          createdAt: row.created_at,
          state: row.state,
          canonicalUrl: row.canonical_url,
          score: row.score ?? 0,
          commentsCount: row.comments_count ?? 0,
        },
      })
    );
  }

  const out = arg("out") ?? join(artifacts, "dataset.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${lines.join("\n")}\n`, "utf8");

  const meta = {
    exportedAt: new Date().toISOString(),
    snapshot: { path: snapshot, source, takenAt: statSync(snapshot).mtime.toISOString() },
    taxonomyVersion: TAXONOMY_VERSION,
    canonicalInputVersion: CANONICAL_INPUT_VERSION,
    counts: { rows: rows.length, labelled, unlabelled: rows.length - labelled, contentChanged: changed },
  };
  writeFileSync(join(artifacts, "dataset.meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  console.log(`rows ${rows.length}, labelled ${labelled}, content changed ${changed}`);
  console.log(`taxonomy ${TAXONOMY_VERSION}, canonical input ${CANONICAL_INPUT_VERSION}`);
  console.log(`wrote ${out}`);
}

main();
