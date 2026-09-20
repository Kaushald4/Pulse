import type { DailyBriefing, ItemState, PulseItem, Project, PulseSchedule, SignalPreference, SourceConnection, Watchlist } from "./types";
import {
  getAllBriefings,
  getSources,
  getProjects,
  getSchedule,
  getSignalPreferences,
  getWatchlists,
  queryItems,
  saveBriefing,
  saveSources,
  saveProject,
  saveSchedule,
  saveSignalPreferences,
  saveWatchlist,
  upsertItems,
} from "./db/sqlite";
import { isTauriEnv } from "./config";

export const LIBRARY_FORMAT = "pulse-library";
export const LIBRARY_VERSION = 2;

export interface LibraryFile {
  format: typeof LIBRARY_FORMAT;
  version: number;
  exportedAt: string;
  items: PulseItem[];
  sources: SourceConnection[];
  briefings: DailyBriefing[];
  preferences: SignalPreference[];
  watchlists: Watchlist[];
  projects: Project[];
  schedule: PulseSchedule;
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export async function buildLibraryExport(): Promise<LibraryFile> {
  const [items, sources, briefings, preferences, watchlists, projects, schedule] = await Promise.all([
    queryItems({}),
    getSources(),
    getAllBriefings(),
    getSignalPreferences(),
    getWatchlists(),
    getProjects(),
    getSchedule(),
  ]);

  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    exportedAt: new Date().toISOString(),
    items,
    sources,
    briefings,
    preferences,
    watchlists,
    projects,
    schedule,
  };
}

/** Opens a native save dialog and writes the library. Returns the path, or null. */
export async function saveLibraryFile(json: string): Promise<string | null> {
  if (!isTauriEnv()) throw new Error("Export requires the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("export_library", { json });
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

/** Opens a native file picker and returns the raw file contents, or null. */
export async function pickLibraryFile(): Promise<string | null> {
  if (!isTauriEnv()) throw new Error("Import requires the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("import_library");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Coerces one imported row into a PulseItem, or returns null when it is missing
 * something required. Imported files are untrusted input, so every field is
 * validated rather than spread straight into the database.
 */
function sanitizeItem(raw: unknown): PulseItem | null {
  if (!isRecord(raw)) return null;

  const id = str(raw.id);
  const title = str(raw.title);
  const url = str(raw.url);
  const source = str(raw.source);
  if (!id || !title || !url || !source) return null;

  const state = (["inbox", "saved", "important", "archived"] as ItemState[]).includes(
    raw.state as ItemState
  )
    ? (raw.state as ItemState)
    : "inbox";

  const category = (["repo", "paper", "resource", "news"] as const).includes(raw.category as never)
    ? (raw.category as PulseItem["category"])
    : "news";

  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [];

  return {
    id,
    source,
    sourceType: str(raw.sourceType) ?? source,
    category,
    field: (str(raw.field) ?? "other") as PulseItem["field"],
    title,
    url,
    body: str(raw.body),
    author: str(raw.author),
    authorUrl: str(raw.authorUrl),
    score: num(raw.score),
    commentsCount: num(raw.commentsCount),
    publishedAt: str(raw.publishedAt) ?? new Date().toISOString(),
    state,
    tags,
    extractedResources: Array.isArray(raw.extractedResources)
      ? (raw.extractedResources as PulseItem["extractedResources"])
      : [],
    createdAt: str(raw.createdAt) ?? new Date().toISOString(),
    topic: str(raw.topic),
    signal: typeof raw.signal === "number" ? raw.signal : null,
    primarySource: typeof raw.primarySource === "boolean" ? raw.primarySource : null,
    whyKey: str(raw.whyKey),
    why: str(raw.why),
    classifierModel: str(raw.classifierModel),
    classifierConfidence: typeof raw.classifierConfidence === "number" ? raw.classifierConfidence : null,
    classifiedAt: str(raw.classifiedAt),
    contentHash: str(raw.contentHash),
  };
}

function sanitizeSource(raw: unknown): SourceConnection | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const source = str(raw.source);
  const name = str(raw.name);
  if (!id || !source || !name) return null;

  return {
    id,
    source,
    name,
    authType: raw.authType === "browser_profile" ? "browser_profile" : "public_api",
    profileName: str(raw.profileName) ?? undefined,
    siteDomain: str(raw.siteDomain) ?? undefined,
    isConnected: raw.isConnected === true,
    monitoredChannels: Array.isArray(raw.monitoredChannels)
      ? raw.monitoredChannels.filter((channel): channel is string => typeof channel === "string")
      : [],
    options: isRecord(raw.options) ? (raw.options as SourceConnection["options"]) : {},
    lastSyncAt: str(raw.lastSyncAt) ?? undefined,
    lastError: str(raw.lastError) ?? undefined,
    enabled: raw.enabled !== false,
  };
}

function sanitizeBriefing(raw: unknown): DailyBriefing | null {
  if (!isRecord(raw)) return null;
  const date = str(raw.date);
  if (!date) return null;

  return {
    id: str(raw.id) ?? date,
    date,
    title: str(raw.title) ?? "Daily Briefing",
    summary: str(raw.summary) ?? "",
    keyHappenings: Array.isArray(raw.keyHappenings)
      ? raw.keyHappenings.filter((entry): entry is string => typeof entry === "string")
      : [],
    sourcesUsed: Array.isArray(raw.sourcesUsed)
      ? raw.sourcesUsed.filter((entry): entry is string => typeof entry === "string")
      : [],
    model: str(raw.model),
    generatedAt: str(raw.generatedAt),
  };
}

export interface ImportSummary {
  items: number;
  sources: number;
  briefings: number;
  skipped: number;
}

/** Validates and merges an exported library. Nothing is deleted by an import. */
export async function importLibrary(rawJson: string): Promise<ImportSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  if (!isRecord(parsed)) throw new Error("That file does not contain a Pulse library.");
  if (parsed.format !== LIBRARY_FORMAT) {
    throw new Error("That file was not exported from Pulse.");
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: PulseItem[] = [];
  let skipped = 0;
  for (const entry of rawItems) {
    const item = sanitizeItem(entry);
    if (item) items.push(item);
    else skipped += 1;
  }

  const sources = (Array.isArray(parsed.sources) ? parsed.sources : [])
    .map(sanitizeSource)
    .filter((source): source is SourceConnection => source !== null);

  const briefings = (Array.isArray(parsed.briefings) ? parsed.briefings : [])
    .map(sanitizeBriefing)
    .filter((briefing): briefing is DailyBriefing => briefing !== null);

  const preferences = Array.isArray(parsed.preferences) ? (parsed.preferences as SignalPreference[]) : [];
  const watchlists = Array.isArray(parsed.watchlists) ? (parsed.watchlists as Watchlist[]) : [];
  const projects = Array.isArray(parsed.projects) ? (parsed.projects as Project[]) : [];
  const schedule = isRecord(parsed.schedule) ? (parsed.schedule as unknown as PulseSchedule) : null;

  if (items.length > 0) await upsertItems(items);
  if (sources.length > 0) await saveSources(sources);
  for (const briefing of briefings) await saveBriefing(briefing);
  if (preferences.length > 0) await saveSignalPreferences(preferences);
  for (const watchlist of watchlists) await saveWatchlist(watchlist);
  for (const project of projects) await saveProject(project);
  if (schedule) await saveSchedule(schedule);

  return { items: items.length, sources: sources.length, briefings: briefings.length, skipped };
}
