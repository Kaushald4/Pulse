/**
 * Table definitions and one-time migrations.
 *
 * Every table lives here so the feature modules (items, jobs) only deal in
 * reads and writes. `ensureSchema` runs once, the first time a database is
 * opened.
 */
import { LEGACY_DEMO_ITEM_IDS } from "../sources/sample-data";
import { groupKeyFor } from "../feed/canonical";
import { ensureJobSchema } from "./jobs-schema";

// 4 was stamped on existing databases by a migration that was later removed. The
// number stays spent: reusing it would make the next migration numbered 4 a no-op
// on those databases, since they already report this version.
const CURRENT_SCHEMA_VERSION = 4;

/* -------------------------------------------------------------------------- */
/* SQLite setup + migrations                                                   */
/* -------------------------------------------------------------------------- */

const ITEM_COLUMNS: Array<[string, string]> = [
  ["source", "TEXT NOT NULL DEFAULT ''"],
  ["source_type", "TEXT NOT NULL DEFAULT ''"],
  ["category", "TEXT NOT NULL DEFAULT 'news'"],
  ["field", "TEXT DEFAULT 'other'"],
  ["title", "TEXT NOT NULL DEFAULT ''"],
  ["url", "TEXT NOT NULL DEFAULT ''"],
  ["body", "TEXT"],
  ["author", "TEXT"],
  ["author_url", "TEXT"],
  ["score", "INTEGER DEFAULT 0"],
  ["comments_count", "INTEGER DEFAULT 0"],
  ["published_at", "TEXT"],
  ["state", "TEXT DEFAULT 'inbox'"],
  ["tags_json", "TEXT DEFAULT '[]'"],
  ["resources_json", "TEXT DEFAULT '[]'"],
  ["created_at", "TEXT"],
  ["topic", "TEXT"],
  ["signal", "REAL"],
  ["primary_source", "INTEGER"],
  ["why_key", "TEXT"],
  ["why", "TEXT"],
  ["jev_model", "TEXT"],
  ["jev_confidence", "REAL"],
  ["jev_at", "TEXT"],
  ["content_hash", "TEXT"],
  ["image_url", "TEXT"],
  ["site_name", "TEXT"],
  ["link_description", "TEXT"],
  ["link_checked_at", "TEXT"],
  ["content_text", "TEXT"],
  ["content_summary", "TEXT"],
  ["content_engine", "TEXT"],
  ["content_fetched_at", "TEXT"],
  ["notes", "TEXT"],
  ["canonical_url", "TEXT"],
];

export async function ensureSchema(db: any): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'news',
      field TEXT DEFAULT 'other',
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      body TEXT,
      author TEXT,
      author_url TEXT,
      score INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      published_at TEXT,
      state TEXT DEFAULT 'inbox',
      tags_json TEXT DEFAULT '[]',
      resources_json TEXT DEFAULT '[]',
      created_at TEXT,
      topic TEXT,
      signal REAL,
      primary_source INTEGER,
      why_key TEXT,
      why TEXT,
      jev_model TEXT,
      jev_confidence REAL,
      jev_at TEXT,
      content_hash TEXT,
      image_url TEXT,
      site_name TEXT,
      link_description TEXT,
      link_checked_at TEXT,
      content_text TEXT,
      content_summary TEXT,
      content_engine TEXT,
      content_fetched_at TEXT,
      notes TEXT,
      canonical_url TEXT
    );
  `);

  const columns = (await db.select(`PRAGMA table_info(items)`)) as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  for (const [name, ddl] of ITEM_COLUMNS) {
    if (!existing.has(name)) {
      await db.execute(`ALTER TABLE items ADD COLUMN ${name} ${ddl};`);
    }
  }

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_field ON items(field);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_state ON items(state);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_signal ON items(signal);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_canonical ON items(canonical_url);`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS signal_preferences (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0,
      evidence INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS watchlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS project_items (
      project_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      PRIMARY KEY(project_id, item_id)
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pulse_schedule (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_minutes INTEGER NOT NULL DEFAULT 360,
      notify INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT
    );
  `);

  await db.execute(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS briefing (
      date TEXT PRIMARY KEY,
      title TEXT,
      summary TEXT,
      key_happenings_json TEXT DEFAULT '[]',
      sources_json TEXT DEFAULT '[]',
      item_ids_json TEXT DEFAULT '[]',
      model TEXT,
      created_at TEXT
    );
  `);

  const briefingColumns = (await db.select(`PRAGMA table_info(briefing)`)) as Array<{ name: string }>;
  if (!briefingColumns.some((column) => column.name === "item_ids_json")) {
    await db.execute(`ALTER TABLE briefing ADD COLUMN item_ids_json TEXT DEFAULT '[]';`);
  }
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT,
      source TEXT,
      auth_type TEXT,
      profile_name TEXT,
      site_domain TEXT,
      is_connected INTEGER DEFAULT 0,
      channels_json TEXT DEFAULT '[]',
      options_json TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      last_sync_at TEXT,
      last_error TEXT
    );
  `);

  const sourceColumns = (await db.select(`PRAGMA table_info(sources)`)) as Array<{ name: string }>;
  if (!sourceColumns.some((column) => column.name === "options_json")) {
    await db.execute(`ALTER TABLE sources ADD COLUMN options_json TEXT DEFAULT '{}';`);
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      summary TEXT,
      error TEXT,
      items INTEGER DEFAULT 0,
      model TEXT,
      provider TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);`);

  // Open Graph previews keyed by URL, for links that have no item row of their
  // own (the built-in curated catalog).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS link_previews (
      url TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      image TEXT,
      site_name TEXT,
      checked_at TEXT
    );
  `);

  await ensureJobSchema(db);
  await migrate(db);
}

async function getMeta(db: any, key: string): Promise<string | null> {
  const rows = (await db.select(`SELECT value FROM app_meta WHERE key = $1;`, [key])) as Array<{
    value: string;
  }>;
  return rows[0]?.value ?? null;
}

async function setMeta(db: any, key: string, value: string): Promise<void> {
  await db.execute(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [key, value]
  );
}

/** One-time cleanup of demo rows written by an earlier build. */
async function migrate(db: any): Promise<void> {
  const version = Number(await getMeta(db, "schema_version")) || 1;
  if (version >= CURRENT_SCHEMA_VERSION) return;

  if (LEGACY_DEMO_ITEM_IDS.length > 0) {
    const placeholders = LEGACY_DEMO_ITEM_IDS.map((_, index) => `$${index + 1}`).join(", ");
    await db.execute(`DELETE FROM items WHERE id IN (${placeholders});`, LEGACY_DEMO_ITEM_IDS);
  }

  await backfillCanonicalUrls(db);

  await setMeta(db, "schema_version", String(CURRENT_SCHEMA_VERSION));
}

/**
 * Gives every existing item its grouping key.
 *
 * Not gated on the schema version, because it is the only thing that fills the
 * column for rows written before it existed, and an interrupted run should
 * resume rather than leave a half-filled table. Cheap when there is nothing to
 * do: one count, then one update per row that needs it.
 */
export async function backfillCanonicalUrls(db: any): Promise<number> {
  const pending = (await db.select(`SELECT id, url FROM items WHERE canonical_url IS NULL;`)) as Array<{
    id: string;
    url: string;
  }>;

  for (const row of pending) {
    // The same key the ingest path writes, so a row's group cannot depend on
    // when it happened to be grouped.
    await db.execute(`UPDATE items SET canonical_url = $1 WHERE id = $2;`, [
      groupKeyFor({ id: row.id, url: row.url ?? "" }),
      row.id,
    ]);
  }

  return pending.length;
}
