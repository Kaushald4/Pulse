import type {
  DailyBriefing,
  ExtractedResource,
  ItemState,
  PulseFilter,
  PulseItem,
  PulseStats,
  ResourceEntry,
  ResourcePreview,
  SortKey,
  SourceConnection,
  SourceOptions,
  TopicSummary,
  Project,
  PulseSchedule,
  SignalPreference,
  Watchlist,
} from "../types";
import { DEFAULT_SOURCES, INITIAL_SAMPLE_ITEMS, LEGACY_DEMO_ITEM_IDS } from "../sources/sample-data";
import { CURATED_RESOURCES } from "../curated-resources";
import { isToday, startOfToday } from "../utils";

const CURRENT_SCHEMA_VERSION = 2;

/** Errors that mean the saved browser session is no longer usable. */
const AUTH_ERROR_RE = /login wall|requires authentication|re-authenticate|not logged in|sign in/i;

const LS_ITEMS = "pulse_items_v4";
const LS_META = "pulse_meta_v1";
const LS_BRIEFINGS = "pulse_briefings_v1";
const LS_SOURCES = "pulse_sources_v1";
const LS_RUNS = "pulse_runs_v1";
const LS_LINK_PREVIEWS = "pulse_link_previews_v1";
const LS_PREFERENCES = "pulse_preferences_v1";
const LS_WATCHLISTS = "pulse_watchlists_v1";
const LS_PROJECTS = "pulse_projects_v1";
const LS_SCHEDULE = "pulse_schedule_v1";

let tauriDb: any = null;
let tauriChecked = false;

function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window;
}

/* -------------------------------------------------------------------------- */
/* Browser fallback storage                                                    */
/* -------------------------------------------------------------------------- */

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error("[Pulse] localStorage write failed:", err);
  }
}

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
];

async function ensureSchema(db: any): Promise<void> {
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
      notes TEXT
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

  await setMeta(db, "schema_version", String(CURRENT_SCHEMA_VERSION));
}

export async function getDatabase(): Promise<any> {
  if (tauriChecked) return tauriDb;
  tauriChecked = true;

  if (!isTauri()) return null;

  try {
    const mod = await import("@tauri-apps/plugin-sql");
    const Database = (mod as any).default ?? mod;
    const db = await Database.load("sqlite:pulse.db");
    await ensureSchema(db);
    tauriDb = db;
  } catch (err) {
    console.warn("[Pulse] SQLite unavailable, using browser storage:", err);
    tauriDb = null;
  }
  return tauriDb;
}

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                 */
/* -------------------------------------------------------------------------- */

const EMPTY_STATS: PulseStats = {
  total: 0,
  inbox: 0,
  saved: 0,
  important: 0,
  archived: 0,
  repos: 0,
  papers: 0,
  resources: 0,
  news: 0,
  aiMl: 0,
  systems: 0,
  web: 0,
  devTools: 0,
  security: 0,
  data: 0,
  other: 0,
};

function rowToItem(row: any): PulseItem {
  return {
    id: row.id,
    source: row.source,
    sourceType: row.source_type,
    category: row.category,
    field: row.field ?? "other",
    title: row.title,
    url: row.url,
    body: row.body ?? null,
    author: row.author ?? null,
    authorUrl: row.author_url ?? null,
    score: row.score ?? 0,
    commentsCount: row.comments_count ?? 0,
    publishedAt: row.published_at,
    state: row.state as ItemState,
    tags: safeParse<string[]>(row.tags_json, []),
    extractedResources: safeParse<ExtractedResource[]>(row.resources_json, []),
    createdAt: row.created_at,
    topic: row.topic ?? null,
    signal: typeof row.signal === "number" ? row.signal : null,
    primarySource: row.primary_source === null || row.primary_source === undefined ? null : Boolean(row.primary_source),
    whyKey: row.why_key ?? null,
    why: row.why ?? null,
    classifierModel: row.jev_model ?? null,
    classifierConfidence: typeof row.jev_confidence === "number" ? row.jev_confidence : null,
    classifiedAt: row.jev_at ?? null,
    contentHash: row.content_hash ?? null,
    imageUrl: row.image_url ?? null,
    siteName: row.site_name ?? null,
    linkDescription: row.link_description ?? null,
    linkCheckedAt: row.link_checked_at ?? null,
    contentText: row.content_text ?? null,
    contentSummary: row.content_summary ?? null,
    contentEngine: row.content_engine ?? null,
    contentFetchedAt: row.content_fetched_at ?? null,
    notes: row.notes ?? null,
  };
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

export async function upsertItems(items: PulseItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDatabase();

  if (db) {
    for (const item of items) {
      await db.execute(
        `INSERT INTO items (
           id, source, source_type, category, field, title, url, body, author, author_url,
           score, comments_count, published_at, state, tags_json, resources_json, created_at,
           topic, signal, primary_source, why_key, why, jev_model, jev_confidence, jev_at, content_hash,
           image_url, site_name, link_description, link_checked_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
         ON CONFLICT(id) DO UPDATE SET
           score = excluded.score,
           comments_count = excluded.comments_count,
           published_at = excluded.published_at,
           image_url = COALESCE(excluded.image_url, items.image_url),
           site_name = COALESCE(excluded.site_name, items.site_name),
           link_description = COALESCE(excluded.link_description, items.link_description),
           field = COALESCE(excluded.field, items.field),
           category = COALESCE(excluded.category, items.category);`,
        [
          item.id,
          item.source,
          item.sourceType,
          item.category,
          item.field,
          item.title,
          item.url,
          item.body,
          item.author,
          item.authorUrl,
          item.score,
          item.commentsCount,
          item.publishedAt,
          item.state,
          JSON.stringify(item.tags ?? []),
          JSON.stringify(item.extractedResources ?? []),
          item.createdAt,
          item.topic ?? null,
          item.signal ?? null,
          item.primarySource === null || item.primarySource === undefined ? null : item.primarySource ? 1 : 0,
          item.whyKey ?? null,
          item.why ?? null,
          item.classifierModel ?? null,
          item.classifierConfidence ?? null,
          item.classifiedAt ?? null,
          item.contentHash ?? null,
          item.imageUrl ?? null,
          item.siteName ?? null,
          item.linkDescription ?? null,
          item.linkCheckedAt ?? null,
        ]
      );
    }
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const map = new Map(store.map((item) => [item.id, item]));
  for (const item of items) {
    const existing = map.get(item.id);
    map.set(item.id, existing ? { ...item, state: existing.state } : item);
  }
  writeLocal(LS_ITEMS, Array.from(map.values()));
}

export async function queryItems(filter: PulseFilter = {}): Promise<PulseItem[]> {
  const db = await getDatabase();

  if (db) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const add = (clause: string, value: unknown) => {
      params.push(value);
      conditions.push(clause.replace("?", `$${params.length}`));
    };

    if (filter.category && filter.category !== "all") add("category = ?", filter.category);
    if (filter.field && filter.field !== "all") add("field = ?", filter.field);
    if (filter.state) add("state = ?", filter.state);
    if (filter.source) add("source = ?", filter.source);
    if (filter.query?.trim()) {
      params.push(`%${filter.query.trim()}%`);
      const p = `$${params.length}`;
      conditions.push(`(title LIKE ${p} OR body LIKE ${p} OR author LIKE ${p})`);
    }
    if (filter.tag) add("tags_json LIKE ?", `%${filter.tag}%`);
    if (filter.publishedSince) add("published_at >= ?", filter.publishedSince);
    if (filter.collectedSince) add("created_at >= ?", filter.collectedSince);

    const orderBy = {
      recent: "published_at DESC",
      score: "score DESC, published_at DESC",
      comments: "comments_count DESC, published_at DESC",
    }[filter.sortBy ?? "recent"];

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = (await db.select(
      `SELECT * FROM items ${where} ORDER BY ${orderBy} LIMIT 200;`,
      params
    )) as any[];
    return rows.map(rowToItem);
  }

  let list = readLocal<PulseItem[]>(LS_ITEMS, []);
  if (filter.category && filter.category !== "all") list = list.filter((i) => i.category === filter.category);
  if (filter.field && filter.field !== "all") list = list.filter((i) => i.field === filter.field);
  if (filter.state) list = list.filter((i) => i.state === filter.state);
  if (filter.source) list = list.filter((i) => i.source === filter.source);
  if (filter.query?.trim()) {
    const q = filter.query.toLowerCase();
    list = list.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.body ?? "").toLowerCase().includes(q) ||
        (i.author ?? "").toLowerCase().includes(q)
    );
  }
  if (filter.tag) list = list.filter((i) => i.tags.includes(filter.tag!));
  if (filter.publishedSince) {
    const since = filter.publishedSince;
    list = list.filter((i) => (i.publishedAt ?? "") >= since);
  }
  if (filter.collectedSince) {
    const since = filter.collectedSince;
    list = list.filter((i) => (i.createdAt ?? "") >= since);
  }

  return sortItems(list, filter.sortBy ?? "recent");
}

function sortItems(list: PulseItem[], sortBy: SortKey): PulseItem[] {
  const copy = [...list];
  if (sortBy === "score") {
    copy.sort((a, b) => b.score - a.score || time(b) - time(a));
  } else if (sortBy === "comments") {
    copy.sort((a, b) => b.commentsCount - a.commentsCount || time(b) - time(a));
  } else {
    copy.sort((a, b) => time(b) - time(a));
  }
  return copy;
}

const time = (item: PulseItem): number => new Date(item.publishedAt).getTime() || 0;

export async function updateItemState(id: string, state: ItemState): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`UPDATE items SET state = $1 WHERE id = $2;`, [state, id]);
    return;
  }
  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const index = store.findIndex((item) => item.id === id);
  if (index !== -1) {
    store[index] = { ...store[index], state };
    writeLocal(LS_ITEMS, store);
  }
}

export async function updateItemNotes(id: string, notes: string): Promise<void> {
  const db = await getDatabase();
  const value = notes.trim() || null;
  if (db) {
    await db.execute(`UPDATE items SET notes = $1 WHERE id = $2;`, [value, id]);
    return;
  }
  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const item = store.find((entry) => entry.id === id);
  if (item) {
    item.notes = value;
    writeLocal(LS_ITEMS, store);
  }
}

function newId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${uuid}`;
}

export async function getSignalPreferences(): Promise<SignalPreference[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT id, kind, value, weight, evidence, updated_at FROM signal_preferences ORDER BY weight DESC;`)) as any[];
    return rows.map((row) => ({ id: row.id, kind: row.kind, value: row.value, weight: row.weight, evidence: row.evidence, updatedAt: row.updated_at }));
  }
  return readLocal<SignalPreference[]>(LS_PREFERENCES, []);
}

export async function recordSignalFeedback(
  kind: SignalPreference["kind"],
  value: string,
  direction: 1 | -1
): Promise<void> {
  const normalized = value.trim();
  if (!normalized) return;
  const id = `${kind}:${normalized.toLowerCase()}`;
  const now = new Date().toISOString();
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO signal_preferences (id, kind, value, weight, evidence, updated_at)
       VALUES ($1,$2,$3,$4,1,$5)
       ON CONFLICT(id) DO UPDATE SET weight = MAX(-1.5, MIN(1.5, signal_preferences.weight + $4)),
       evidence = signal_preferences.evidence + 1, updated_at = $5;`,
      [id, kind, normalized, direction * 0.25, now]
    );
    return;
  }
  const preferences = readLocal<SignalPreference[]>(LS_PREFERENCES, []);
  const existing = preferences.find((preference) => preference.id === id);
  if (existing) {
    existing.weight = Math.max(-1.5, Math.min(1.5, existing.weight + direction * 0.25));
    existing.evidence += 1;
    existing.updatedAt = now;
  } else {
    preferences.push({ id, kind, value: normalized, weight: direction * 0.25, evidence: 1, updatedAt: now });
  }
  writeLocal(LS_PREFERENCES, preferences);
}

export async function saveSignalPreferences(preferences: SignalPreference[]): Promise<void> {
  const db = await getDatabase();
  if (db) {
    for (const preference of preferences) {
      await db.execute(
        `INSERT INTO signal_preferences (id, kind, value, weight, evidence, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET weight = excluded.weight, evidence = excluded.evidence, updated_at = excluded.updated_at;`,
        [preference.id, preference.kind, preference.value, preference.weight, preference.evidence, preference.updatedAt]
      );
    }
    return;
  }
  writeLocal(LS_PREFERENCES, preferences);
}

export async function getWatchlists(): Promise<Watchlist[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM watchlists ORDER BY created_at DESC;`)) as any[];
    return rows.map((row) => ({ id: row.id, name: row.name, query: row.query, enabled: Boolean(row.enabled), createdAt: row.created_at }));
  }
  return readLocal<Watchlist[]>(LS_WATCHLISTS, []);
}

export async function saveWatchlist(watchlist: Watchlist): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO watchlists (id, name, query, enabled, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, query = excluded.query, enabled = excluded.enabled;`,
      [watchlist.id, watchlist.name, watchlist.query, watchlist.enabled ? 1 : 0, watchlist.createdAt]
    );
    return;
  }
  const list = readLocal<Watchlist[]>(LS_WATCHLISTS, []);
  const index = list.findIndex((entry) => entry.id === watchlist.id);
  if (index === -1) list.unshift(watchlist);
  else list[index] = watchlist;
  writeLocal(LS_WATCHLISTS, list);
}

export async function deleteWatchlist(id: string): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM watchlists WHERE id = $1;`, [id]);
    return;
  }
  writeLocal(LS_WATCHLISTS, readLocal<Watchlist[]>(LS_WATCHLISTS, []).filter((entry) => entry.id !== id));
}

export async function getProjects(): Promise<Project[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM projects ORDER BY created_at DESC;`)) as any[];
    const itemRows = (await db.select(`SELECT project_id, item_id FROM project_items;`)) as any[];
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, createdAt: row.created_at, itemIds: itemRows.filter((item) => item.project_id === row.id).map((item) => item.item_id) }));
  }
  return readLocal<Project[]>(LS_PROJECTS, []);
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO projects (id, name, description, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description;`,
      [project.id, project.name, project.description, project.createdAt]
    );
    await db.execute(`DELETE FROM project_items WHERE project_id = $1;`, [project.id]);
    for (const itemId of project.itemIds) await db.execute(`INSERT INTO project_items (project_id, item_id) VALUES ($1,$2);`, [project.id, itemId]);
    return;
  }
  const projects = readLocal<Project[]>(LS_PROJECTS, []);
  const index = projects.findIndex((entry) => entry.id === project.id);
  if (index === -1) projects.unshift(project);
  else projects[index] = project;
  writeLocal(LS_PROJECTS, projects);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM project_items WHERE project_id = $1;`, [id]);
    await db.execute(`DELETE FROM projects WHERE id = $1;`, [id]);
    return;
  }
  writeLocal(LS_PROJECTS, readLocal<Project[]>(LS_PROJECTS, []).filter((entry) => entry.id !== id));
}

export async function getSchedule(): Promise<PulseSchedule> {
  const fallback: PulseSchedule = { id: "default", enabled: false, intervalMinutes: 360, notify: true };
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM pulse_schedule WHERE id = 'default' LIMIT 1;`)) as any[];
    const row = rows[0];
    return row ? { id: row.id, enabled: Boolean(row.enabled), intervalMinutes: row.interval_minutes, notify: Boolean(row.notify), lastRunAt: row.last_run_at, nextRunAt: row.next_run_at } : fallback;
  }
  return readLocal<PulseSchedule>(LS_SCHEDULE, fallback);
}

export async function saveSchedule(schedule: PulseSchedule): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO pulse_schedule (id, enabled, interval_minutes, notify, last_run_at, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, interval_minutes = excluded.interval_minutes,
       notify = excluded.notify, last_run_at = excluded.last_run_at, next_run_at = excluded.next_run_at;`,
      [schedule.id, schedule.enabled ? 1 : 0, schedule.intervalMinutes, schedule.notify ? 1 : 0, schedule.lastRunAt ?? null, schedule.nextRunAt ?? null]
    );
    return;
  }
  writeLocal(LS_SCHEDULE, schedule);
}

export function createWatchlist(name: string, query: string): Watchlist {
  return { id: newId("watch"), name: name.trim(), query: query.trim(), enabled: true, createdAt: new Date().toISOString() };
}

export function createProject(name: string, description = ""): Project {
  return { id: newId("project"), name: name.trim(), description: description.trim(), createdAt: new Date().toISOString(), itemIds: [] };
}

/** Items that have never been classified, or whose content changed. */
export async function getUnclassifiedItems(limit = 60): Promise<PulseItem[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM items
       WHERE jev_at IS NULL OR content_hash IS NULL
       ORDER BY published_at DESC LIMIT $1;`,
      [limit]
    )) as any[];
    return rows.map(rowToItem);
  }
  return readLocal<PulseItem[]>(LS_ITEMS, [])
    .filter((item) => !item.classifiedAt || !item.contentHash)
    .slice(0, limit);
}

export interface ClassificationUpdate {
  id: string;
  category: PulseItem["category"];
  field: PulseItem["field"];
  topic: string;
  signal: number | null;
  primarySource: boolean | null;
  whyKey: string;
  classifierModel: string | null;
  classifierConfidence: number | null;
  contentHash: string;
  tags: string[];
  extractedResources: PulseItem["extractedResources"];
}

export async function applyClassifications(updates: ClassificationUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    for (const update of updates) {
      await db.execute(
        `UPDATE items SET
           category = $1, field = $2, topic = $3, signal = $4, primary_source = $5,
           why_key = $6, jev_model = $7, jev_confidence = $8, jev_at = $9,
           content_hash = $10, tags_json = $11, resources_json = $12
         WHERE id = $13;`,
        [
          update.category,
          update.field,
          update.topic,
          update.signal,
          update.primarySource === null ? null : update.primarySource ? 1 : 0,
          update.whyKey,
          update.classifierModel,
          update.classifierConfidence,
          now,
          update.contentHash,
          JSON.stringify(update.tags ?? []),
          JSON.stringify(update.extractedResources ?? []),
          update.id,
        ]
      );
    }
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const byId = new Map(updates.map((update) => [update.id, update]));
  for (const item of store) {
    const update = byId.get(item.id);
    if (!update) continue;
    item.category = update.category;
    item.field = update.field;
    item.topic = update.topic;
    item.signal = update.signal;
    item.primarySource = update.primarySource;
    item.whyKey = update.whyKey;
    item.classifierModel = update.classifierModel;
    item.classifierConfidence = update.classifierConfidence;
    item.classifiedAt = now;
    item.contentHash = update.contentHash;
    item.tags = update.tags;
    item.extractedResources = update.extractedResources;
  }
  writeLocal(LS_ITEMS, store);
}

export async function applyReasons(reasons: Map<string, string>): Promise<void> {
  if (reasons.size === 0) return;
  const db = await getDatabase();

  if (db) {
    for (const [id, why] of reasons) {
      await db.execute(`UPDATE items SET why = $1 WHERE id = $2;`, [why, id]);
    }
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  for (const item of store) {
    const why = reasons.get(item.id);
    if (why) item.why = why;
  }
  writeLocal(LS_ITEMS, store);
}

/* -------------------------------------------------------------------------- */
/* Stats + topics + resources                                                  */
/* -------------------------------------------------------------------------- */

export async function getPulseStats(): Promise<PulseStats> {
  const db = await getDatabase();

  if (db) {
    const rows = (await db.select(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN state='inbox' THEN 1 ELSE 0 END) AS inbox,
        SUM(CASE WHEN state='saved' THEN 1 ELSE 0 END) AS saved,
        SUM(CASE WHEN state='important' THEN 1 ELSE 0 END) AS important,
        SUM(CASE WHEN state='archived' THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN category='repo' THEN 1 ELSE 0 END) AS repos,
        SUM(CASE WHEN category='paper' THEN 1 ELSE 0 END) AS papers,
        SUM(CASE WHEN category='resource' THEN 1 ELSE 0 END) AS resources,
        SUM(CASE WHEN category='news' THEN 1 ELSE 0 END) AS news,
        SUM(CASE WHEN field='ai_ml' THEN 1 ELSE 0 END) AS ai_ml,
        SUM(CASE WHEN field='systems_infra' THEN 1 ELSE 0 END) AS systems,
        SUM(CASE WHEN field='web_frontend' THEN 1 ELSE 0 END) AS web,
        SUM(CASE WHEN field='developer_tools' THEN 1 ELSE 0 END) AS dev_tools,
        SUM(CASE WHEN field='security' THEN 1 ELSE 0 END) AS security,
        SUM(CASE WHEN field='data' THEN 1 ELSE 0 END) AS data,
        SUM(CASE WHEN field='other' THEN 1 ELSE 0 END) AS other
      FROM items;
    `)) as any[];
    const row = rows[0] ?? {};
    return {
      total: row.total ?? 0,
      inbox: row.inbox ?? 0,
      saved: row.saved ?? 0,
      important: row.important ?? 0,
      archived: row.archived ?? 0,
      repos: row.repos ?? 0,
      papers: row.papers ?? 0,
      resources: row.resources ?? 0,
      news: row.news ?? 0,
      aiMl: row.ai_ml ?? 0,
      systems: row.systems ?? 0,
      web: row.web ?? 0,
      devTools: row.dev_tools ?? 0,
      security: row.security ?? 0,
      data: row.data ?? 0,
      other: row.other ?? 0,
    };
  }

  const list = readLocal<PulseItem[]>(LS_ITEMS, []);
  if (list.length === 0) return { ...EMPTY_STATS };
  return {
    total: list.length,
    inbox: list.filter((i) => i.state === "inbox").length,
    saved: list.filter((i) => i.state === "saved").length,
    important: list.filter((i) => i.state === "important").length,
    archived: list.filter((i) => i.state === "archived").length,
    repos: list.filter((i) => i.category === "repo").length,
    papers: list.filter((i) => i.category === "paper").length,
    resources: list.filter((i) => i.category === "resource").length,
    news: list.filter((i) => i.category === "news").length,
    aiMl: list.filter((i) => i.field === "ai_ml").length,
    systems: list.filter((i) => i.field === "systems_infra").length,
    web: list.filter((i) => i.field === "web_frontend").length,
    devTools: list.filter((i) => i.field === "developer_tools").length,
    security: list.filter((i) => i.field === "security").length,
    data: list.filter((i) => i.field === "data").length,
    other: list.filter((i) => i.field === "other").length,
  };
}

const DAY = 86_400_000;
const TOPIC_WINDOW_DAYS = 7;
const MAX_RISING_TOPICS = 6;
/** A topic needs at least this many items in a window to be worth ranking. */
const MIN_TOPIC_ITEMS = 2;

/**
 * Umbrella buckets, not movers. `other` is Jev's no-match outcome, so ranking it
 * as a "rising topic" is meaningless. Mirrors journal's `rejectMegaTopics`.
 */
const MEGA_TOPICS = new Set(["other"]);

/**
 * Topic activity for the current window versus the immediately preceding one —
 * journal's `getTopicVelocity` shape, computed over items rather than clustered
 * events (Pulse has no clustering layer).
 *
 * Two deliberate differences from a naive implementation:
 *  - Only Jev's assigned `topic` counts. Falling back to `tags[0]` mixed
 *    unrelated keyword tags into the same ranking.
 *  - When the prior window is empty there is no velocity to report, so `delta`
 *    is null and `hasBaseline` is false. The UI changes its heading instead of
 *    stamping every row "new".
 */
export async function getTopicSummary(): Promise<TopicSummary> {
  const items = await queryItems({});
  const now = Date.now();
  const current = new Map<string, number>();
  const prior = new Map<string, number>();

  for (const item of items) {
    const topic = item.topic?.trim();
    if (!topic || MEGA_TOPICS.has(topic)) continue;

    const published = new Date(item.publishedAt).getTime();
    if (Number.isNaN(published)) continue;

    const age = now - published;
    const bucket =
      age <= TOPIC_WINDOW_DAYS * DAY
        ? current
        : age <= 2 * TOPIC_WINDOW_DAYS * DAY
        ? prior
        : null;
    if (!bucket) continue;

    bucket.set(topic, (bucket.get(topic) ?? 0) + 1);
  }

  const hasBaseline = Array.from(prior.values()).some((count) => count > 0);
  const maxCount = Math.max(1, ...current.values());

  const topics = Array.from(current.entries())
    .map(([topic, count]) => {
      const previous = prior.get(topic) ?? 0;
      const { delta, rising } = topicDelta(count, previous, hasBaseline);
      return { topic, count, previous, momentum: count / maxCount, delta, rising };
    })
    .filter((entry) => entry.count >= MIN_TOPIC_ITEMS)
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, MAX_RISING_TOPICS);

  return { topics, hasBaseline, windowDays: TOPIC_WINDOW_DAYS };
}

/** Journal's `eventDelta`: "new" when there is no prior data, else a real %. */
function topicDelta(
  current: number,
  previous: number,
  hasBaseline: boolean
): { delta: string | null; rising: boolean } {
  if (!hasBaseline) return { delta: null, rising: false };
  if (previous === 0) return { delta: current > 0 ? "new" : null, rising: current > 0 };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { delta: "0%", rising: false };
  return { delta: `${pct > 0 ? "+" : ""}${pct}%`, rising: pct > 0 };
}

/**
 * Aggregates detected resources across every item, deduped by URL with a real
 * mention count — the shape journal's `resources` table carries.
 *
 * Nothing is synthesized from an item's own category: resources come only from
 * `detectResources`, which refuses to promote an item's own permalink unless it
 * is a genuinely named tool.
 */
export async function getAllResources(): Promise<ResourceEntry[]> {
  const [items, previews] = await Promise.all([queryItems({}), getLinkPreviews()]);
  const byUrl = new Map<string, ResourceEntry>();

  for (const item of items) {
    const published = publishedAt(item);

    for (const resource of item.extractedResources ?? []) {
      const existing = byUrl.get(resource.url);
      if (existing) {
        existing.mentions += 1;
        if (published > publishedAt(existing.item)) {
          existing.item = item;
        }
        continue;
      }
      byUrl.set(resource.url, { resource, mentions: 1, item });
    }
  }

  const detected = Array.from(byUrl.values()).sort((a, b) => {
    if (b.mentions !== a.mentions) return b.mentions - a.mentions;
    const aScore = a.item?.score ?? 0;
    const bScore = b.item?.score ?? 0;
    if (bScore !== aScore) return bScore - aScore;
    return publishedAt(b.item) - publishedAt(a.item);
  });

  // Built-in curated links ride alongside detected ones. Anything already
  // surfaced from real content wins, so a link never appears twice.
  const seen = new Set(detected.map((entry) => entry.resource.url.toLowerCase()));
  const curated: ResourceEntry[] = CURATED_RESOURCES.filter(
    (resource) => !seen.has(resource.url.toLowerCase())
  ).map((resource) => ({ resource, mentions: 0, curated: true }));

  return [...detected, ...curated].map((entry) => ({
    ...entry,
    preview: previewFor(entry, previews),
  }));
}

function publishedAt(item?: PulseItem): number {
  return item ? new Date(item.publishedAt).getTime() || 0 : 0;
}

/** Items published today on the local clock — the briefing's source material. */
export async function getBriefingCandidates(limit = 16): Promise<PulseItem[]> {
  const items = await queryItems({ sortBy: "recent", publishedSince: startOfToday() });
  return items.filter((item) => isToday(item.publishedAt)).slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Briefings                                                                   */
/* -------------------------------------------------------------------------- */

export async function getBriefing(date: string): Promise<DailyBriefing | null> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM briefing WHERE date = $1;`, [date])) as any[];
    const row = rows[0];
    if (!row) return null;
    return rowToBriefing(row);
  }

  const briefings = readLocal<Record<string, DailyBriefing>>(LS_BRIEFINGS, {});
  return briefings[date] ?? null;
}

function rowToBriefing(row: any): DailyBriefing {
  return {
    id: row.date,
    date: row.date,
    title: row.title ?? "Daily Briefing",
    summary: row.summary ?? "",
    keyHappenings: safeParse<string[]>(row.key_happenings_json, []),
    sourcesUsed: safeParse<string[]>(row.sources_json, []),
    // Absent on rows written before item tracking existed — treated as stale.
    itemIds: row.item_ids_json === undefined ? undefined : safeParse<string[]>(row.item_ids_json, []),
    model: row.model ?? null,
    generatedAt: row.created_at ?? null,
  };
}

/** Replaces an item's detected resource list (used after a page fetch). */
export async function applyResources(id: string, resources: unknown[]): Promise<void> {
  const db = await getDatabase();
  const json = JSON.stringify(resources ?? []);

  if (db) {
    await db.execute(`UPDATE items SET resources_json = $1 WHERE id = $2;`, [json, id]);
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const item = store.find((entry) => entry.id === id);
  if (item) {
    item.extractedResources = resources as PulseItem["extractedResources"];
    writeLocal(LS_ITEMS, store);
  }
}

/** Stores fetched page content and its summary. Pass null text to keep the old one. */
export async function applyContent(
  id: string,
  content: {
    text?: string | null;
    summary?: string | null;
    engine?: string | null;
    imageUrl?: string | null;
    siteName?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `UPDATE items SET
         content_text = COALESCE($1, content_text),
         content_summary = COALESCE($2, content_summary),
         content_engine = COALESCE($3, content_engine),
         image_url = COALESCE($4, image_url),
         site_name = COALESCE($5, site_name),
         content_fetched_at = $6
       WHERE id = $7;`,
      [
        content.text ?? null,
        content.summary ?? null,
        content.engine ?? null,
        content.imageUrl ?? null,
        content.siteName ?? null,
        now,
        id,
      ]
    );
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const item = store.find((entry) => entry.id === id);
  if (item) {
    if (content.text) item.contentText = content.text;
    if (content.summary) item.contentSummary = content.summary;
    if (content.engine) item.contentEngine = content.engine;
    if (content.imageUrl) item.imageUrl = content.imageUrl;
    if (content.siteName) item.siteName = content.siteName;
    item.contentFetchedAt = now;
    writeLocal(LS_ITEMS, store);
  }
}

export interface LinkMetadataUpdate {
  id: string;
  imageUrl: string | null;
  siteName: string | null;
  linkDescription: string | null;
}

/** Records a preview fetch attempt, successful or not, so we never retry forever. */
export async function applyLinkMetadata(updates: LinkMetadataUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    for (const update of updates) {
      await db.execute(
        `UPDATE items SET image_url = $1, site_name = $2, link_description = $3, link_checked_at = $4
         WHERE id = $5;`,
        [update.imageUrl, update.siteName, update.linkDescription, now, update.id]
      );
    }
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const byId = new Map(updates.map((update) => [update.id, update]));
  for (const item of store) {
    const update = byId.get(item.id);
    if (!update) continue;
    item.imageUrl = update.imageUrl;
    item.siteName = update.siteName;
    item.linkDescription = update.linkDescription;
    item.linkCheckedAt = now;
  }
  writeLocal(LS_ITEMS, store);
}

/** Items whose link preview has never been attempted. */
export async function getItemsNeedingMetadata(limit = 40): Promise<PulseItem[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM items WHERE link_checked_at IS NULL ORDER BY published_at DESC LIMIT $1;`,
      [limit]
    )) as any[];
    return rows.map(rowToItem);
  }
  return readLocal<PulseItem[]>(LS_ITEMS, [])
    .filter((item) => !item.linkCheckedAt)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Link previews (URL-keyed)                                                   */
/* -------------------------------------------------------------------------- */

function rowToPreview(row: any): ResourcePreview {
  return {
    title: row.title ?? null,
    description: row.description ?? null,
    image: row.image ?? null,
  };
}

/** Every captured link preview, keyed by URL. */
export async function getLinkPreviews(): Promise<Map<string, ResourcePreview>> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT url, title, description, image FROM link_previews;`)) as any[];
    return new Map(rows.map((row) => [row.url, rowToPreview(row)]));
  }
  const store = readLocal<Record<string, ResourcePreview>>(LS_LINK_PREVIEWS, {});
  return new Map(Object.entries(store));
}

export interface LinkPreviewUpdate extends ResourcePreview {
  url: string;
  siteName: string | null;
}

/**
 * Records a preview fetch for each URL — including failures, so a dead link is
 * not re-fetched on every launch.
 */
export async function applyLinkPreviews(updates: LinkPreviewUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    for (const update of updates) {
      await db.execute(
        `INSERT INTO link_previews (url, title, description, image, site_name, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT(url) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           image = excluded.image, site_name = excluded.site_name, checked_at = excluded.checked_at;`,
        [update.url, update.title, update.description, update.image, update.siteName, now]
      );
    }
    return;
  }

  const store = readLocal<Record<string, ResourcePreview>>(LS_LINK_PREVIEWS, {});
  for (const update of updates) {
    store[update.url] = {
      title: update.title,
      description: update.description,
      image: update.image,
    };
  }
  writeLocal(LS_LINK_PREVIEWS, store);
}

/** One entry's preview, preferring a captured Open Graph fetch over item data. */
function previewFor(entry: ResourceEntry, previews: Map<string, ResourcePreview>): ResourcePreview {
  const stored = previews.get(entry.resource.url);
  const item = entry.item;
  return {
    title: stored?.title ?? null,
    description: stored?.description ?? item?.linkDescription ?? item?.why ?? item?.body ?? null,
    image: stored?.image ?? item?.imageUrl ?? null,
  };
}

/** Every stored briefing, for library export. */
export async function getAllBriefings(): Promise<DailyBriefing[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM briefing;`)) as any[];
    return rows.map(rowToBriefing);
  }
  return Object.values(readLocal<Record<string, DailyBriefing>>(LS_BRIEFINGS, {}));
}

export async function saveBriefing(briefing: DailyBriefing): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO briefing (date, title, summary, key_happenings_json, sources_json, item_ids_json, model, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(date) DO UPDATE SET
         title = excluded.title,
         summary = excluded.summary,
         key_happenings_json = excluded.key_happenings_json,
         sources_json = excluded.sources_json,
         item_ids_json = excluded.item_ids_json,
         model = excluded.model,
         created_at = excluded.created_at;`,
      [
        briefing.date,
        briefing.title,
        briefing.summary,
        JSON.stringify(briefing.keyHappenings ?? []),
        JSON.stringify(briefing.sourcesUsed ?? []),
        JSON.stringify(briefing.itemIds ?? []),
        briefing.model ?? null,
        briefing.generatedAt ?? new Date().toISOString(),
      ]
    );
    return;
  }

  const briefings = readLocal<Record<string, DailyBriefing>>(LS_BRIEFINGS, {});
  briefings[briefing.date] = briefing;
  writeLocal(LS_BRIEFINGS, briefings);
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

function rowToSource(row: any): SourceConnection {
  return {
    id: row.id,
    source: row.source,
    name: row.name,
    authType: row.auth_type,
    profileName: row.profile_name ?? undefined,
    siteDomain: row.site_domain ?? undefined,
    isConnected: Boolean(row.is_connected),
    monitoredChannels: safeParse<string[]>(row.channels_json, []),
    options: safeParse<SourceOptions>(row.options_json, {}),
    enabled: row.enabled === null || row.enabled === undefined ? true : Boolean(row.enabled),
    lastSyncAt: row.last_sync_at ?? undefined,
    lastError: row.last_error ?? undefined,
  };
}

/**
 * Saved rows win, but any option they never set is filled from the current
 * default — so improved defaults reach existing installs while real user
 * choices are never overwritten.
 */
function mergeSourceDefaults(
  source: SourceConnection,
  saved: SourceConnection
): SourceConnection {
  return {
    ...saved,
    options: { ...source.options, ...saved.options },
    monitoredChannels:
      (saved.monitoredChannels?.length ?? 0) > 0 ? saved.monitoredChannels : source.monitoredChannels,
  };
}

export async function getSources(): Promise<SourceConnection[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM sources;`)) as any[];
    if (rows.length === 0) {
      await persistSources(db, DEFAULT_SOURCES);
      return DEFAULT_SOURCES.map((source) => ({ ...source }));
    }
    const byId = new Map(rows.map((row) => [row.id, rowToSource(row)]));
    return DEFAULT_SOURCES.map((source) => {
      const saved = byId.get(source.id);
      return saved ? mergeSourceDefaults(source, saved) : source;
    });
  }

  const stored = readLocal<SourceConnection[]>(LS_SOURCES, []);
  if (stored.length === 0) return DEFAULT_SOURCES.map((source) => ({ ...source }));
  const byId = new Map(stored.map((source) => [source.id, source]));
  return DEFAULT_SOURCES.map((source) => {
    const saved = byId.get(source.id);
    return saved ? mergeSourceDefaults(source, saved) : source;
  });
}

async function persistSources(db: any, sources: SourceConnection[]): Promise<void> {
  for (const source of sources) {
    await db.execute(
      `INSERT INTO sources (id, name, source, auth_type, profile_name, site_domain, is_connected, channels_json, options_json, enabled, last_sync_at, last_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(id) DO UPDATE SET
         is_connected = excluded.is_connected,
         channels_json = excluded.channels_json,
         options_json = excluded.options_json,
         enabled = excluded.enabled,
         last_sync_at = COALESCE(excluded.last_sync_at, sources.last_sync_at),
         last_error = excluded.last_error;`,
      [
        source.id,
        source.name,
        source.source,
        source.authType,
        source.profileName ?? null,
        source.siteDomain ?? null,
        source.isConnected ? 1 : 0,
        JSON.stringify(source.monitoredChannels ?? []),
        JSON.stringify(source.options ?? {}),
        source.enabled === false ? 0 : 1,
        source.lastSyncAt ?? null,
        source.lastError ?? null,
      ]
    );
  }
}

export async function saveSources(sources: SourceConnection[]): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await persistSources(db, sources);
    return;
  }
  writeLocal(LS_SOURCES, sources);
}

export async function recordSyncResult(
  source: string,
  result: { ok: boolean; lastSyncAt?: string; error?: string }
): Promise<void> {
  const sources = await getSources();
  const authFailure = !result.ok && AUTH_ERROR_RE.test(result.error ?? "");

  const next = sources.map((entry) =>
    entry.source === source || entry.id === source
      ? {
          ...entry,
          lastSyncAt: result.ok ? result.lastSyncAt ?? new Date().toISOString() : entry.lastSyncAt,
          // A successful sync is the only real proof the saved profile works.
          // A directory existing proves nothing, so we never infer from that.
          isConnected: result.ok ? true : authFailure ? false : entry.isConnected,
          lastError: result.ok ? undefined : result.error,
        }
      : entry
  );
  await saveSources(next);
}

/* -------------------------------------------------------------------------- */
/* Run log                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A record of one operation — a source sync, a classification batch, a briefing,
 * or an article fetch. Long operations are inserted as `running` first so the
 * UI can show live progress, then finished with their outcome and token usage.
 */
export type RunCategory = "sync" | "classify" | "briefing" | "content";
export type RunStatus = "running" | "success" | "failed";

export interface RunRecord {
  id: string;
  category: RunCategory;
  label: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  items: number;
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
}

function rowToRun(row: any): RunRecord {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    summary: row.summary ?? null,
    error: row.error ?? null,
    items: row.items ?? 0,
    model: row.model ?? null,
    provider: row.provider ?? null,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
  };
}

export async function startRun(entry: {
  category: RunCategory;
  label: string;
  model?: string | null;
  provider?: string | null;
}): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `INSERT INTO runs (id, category, label, status, started_at, model, provider)
       VALUES ($1,$2,$3,'running',$4,$5,$6);`,
      [id, entry.category, entry.label, startedAt, entry.model ?? null, entry.provider ?? null]
    );
    return id;
  }

  const runs = readLocal<RunRecord[]>(LS_RUNS, []);
  runs.unshift({
    id,
    category: entry.category,
    label: entry.label,
    status: "running",
    startedAt,
    finishedAt: null,
    summary: null,
    error: null,
    items: 0,
    model: entry.model ?? null,
    provider: entry.provider ?? null,
    inputTokens: 0,
    outputTokens: 0,
  });
  writeLocal(LS_RUNS, runs.slice(0, 500));
  return id;
}

export async function finishRun(
  id: string,
  result: {
    status: RunStatus;
    summary?: string | null;
    error?: string | null;
    items?: number;
    model?: string | null;
    provider?: string | null;
    inputTokens?: number;
    outputTokens?: number;
  }
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `UPDATE runs SET status = $1, finished_at = $2, summary = $3, error = $4, items = $5,
         model = COALESCE($6, model), provider = COALESCE($7, provider),
         input_tokens = $8, output_tokens = $9
       WHERE id = $10;`,
      [
        result.status,
        finishedAt,
        result.summary ?? null,
        result.error ?? null,
        result.items ?? 0,
        result.model ?? null,
        result.provider ?? null,
        result.inputTokens ?? 0,
        result.outputTokens ?? 0,
        id,
      ]
    );
    return;
  }

  const runs = readLocal<RunRecord[]>(LS_RUNS, []);
  const run = runs.find((entry) => entry.id === id);
  if (!run) return;
  run.status = result.status;
  run.finishedAt = finishedAt;
  run.summary = result.summary ?? null;
  run.error = result.error ?? null;
  run.items = result.items ?? 0;
  run.model = result.model ?? run.model;
  run.provider = result.provider ?? run.provider;
  run.inputTokens = result.inputTokens ?? 0;
  run.outputTokens = result.outputTokens ?? 0;
  writeLocal(LS_RUNS, runs);
}

export async function getRuns(limit = 200): Promise<RunRecord[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM runs ORDER BY started_at DESC LIMIT $1;`,
      [limit]
    )) as any[];
    return rows.map(rowToRun);
  }
  // The localStorage fallback keeps insertion order, so sort it explicitly to
  // match the SQLite path's newest-first ORDER BY.
  return readLocal<RunRecord[]>(LS_RUNS, [])
    .slice()
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Demo data + maintenance                                                     */
/* -------------------------------------------------------------------------- */

export async function loadDemoData(): Promise<number> {
  await upsertItems(INITIAL_SAMPLE_ITEMS);
  return INITIAL_SAMPLE_ITEMS.length;
}

export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM items;`);
    await db.execute(`DELETE FROM briefing;`);
    await db.execute(`DELETE FROM runs;`);
    return;
  }
  writeLocal(LS_ITEMS, []);
  writeLocal(LS_BRIEFINGS, {});
  writeLocal(LS_RUNS, []);
}
