import { create } from "zustand";
import type {
  AppConfig,
  ContentField,
  DailyBriefing,
  ItemCategory,
  ItemState,
  PulseFilter,
  PulseItem,
  PulseStats,
  ResourceEntry,
  SortKey,
  SourceConnection,
  SourceOptions,
  TopicSummary,
  Project,
  PulseSchedule,
  SignalPreference,
  Watchlist,
} from "../lib/types";
import {
  EMPTY_CONFIG,
  getConfig,
  isTauriEnv,
  publishWidgetSnapshot,
  saveConfig as persistConfig,
} from "../lib/config";
import {
  clearAllData,
  getAllResources,
  getPulseStats,
  getRuns,
  getSources,
  getTopicSummary,
  getProjects,
  getSchedule,
  getSignalPreferences,
  getWatchlists,
  loadDemoData,
  queryItems,
  saveSources,
  saveProject,
  saveSchedule,
  saveWatchlist,
  deleteProject,
  deleteWatchlist,
  recordSignalFeedback,
  createProject,
  createWatchlist,
  updateItemState,
  updateItemNotes,
  type RunRecord,
} from "../lib/db/sqlite";
import { ensureBriefing, syncSources, type SyncProgress } from "../lib/pipeline";
import { fetchAndSummarize } from "../lib/content";
import { fetchCuratedPreviews } from "../lib/metadata";
import { startOfToday } from "../lib/utils";
import {
  buildLibraryExport,
  importLibrary as applyLibraryFile,
  pickLibraryFile,
  saveLibraryFile,
} from "../lib/library";
import { describeOptions, disconnectProfile, launchAuthLogin, profileExists, requiresProfile } from "../lib/sources/fetcher";
import { toast } from "../lib/toast";

export type NavigationTab = "today" | "feed" | "resources" | "projects" | "sources" | "logs" | "settings";

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

interface Filters {
  category: ItemCategory;
  field: ContentField;
  /** "all" means no triage filter — otherwise a category and a state would
   *  silently intersect and hide items the sidebar count promised. */
  state: ItemState | "all";
  source?: string;
  query: string;
  tag?: string;
  sortBy: SortKey;
}

const DEFAULT_FILTERS: Filters = {
  category: "all",
  field: "all",
  state: "all",
  query: "",
  sortBy: "recent",
};

/** The store's filters, translated into a DB query. */
function toQuery(filters: Filters): PulseFilter {
  return {
    category: filters.category,
    field: filters.field,
    state: filters.state === "all" ? undefined : filters.state,
    source: filters.source,
    query: filters.query,
    tag: filters.tag,
    sortBy: filters.sortBy,
  };
}

interface PulseStore {
  ready: boolean;
  desktop: boolean;
  config: AppConfig;

  items: PulseItem[];
  /** Items published today on the local clock — resets at local midnight. */
  todayItems: PulseItem[];
  /** Items *collected* today (first seen), whenever they were published. */
  newItems: PulseItem[];
  stats: PulseStats;
  topicSummary: TopicSummary | null;
  resources: ResourceEntry[];
  briefing: DailyBriefing | null;
  sources: SourceConnection[];
  preferences: SignalPreference[];
  watchlists: Watchlist[];
  projects: Project[];
  schedule: PulseSchedule;

  /** The audit log: every recorded operation, newest first. */
  runs: RunRecord[];
  /** When the most recent successful sync finished, for "last synced at". */
  lastSyncedAt: string | null;

  view: NavigationTab;
  filters: Filters;
  selectedItemId: string | null;
  drawerOpen: boolean;
  paletteOpen: boolean;

  syncing: boolean;
  briefingLoading: boolean;
  /** Which source the running sync is on, for visible progress. */
  syncProgress: SyncProgress | null;
  /** The one source whose spinner should be active. */
  syncingSource: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Re-queries only the item list — for filter changes, which change nothing else. */
  refreshItems: () => Promise<void>;
  refreshSources: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  /** Fetches Open Graph previews for links that don't have them yet. */
  refreshPreviews: () => Promise<void>;

  setView: (view: NavigationTab) => void;
  setFilter: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  selectItem: (id: string | null) => void;
  openDrawer: (id?: string) => void;
  closeDrawer: () => void;
  setPaletteOpen: (open: boolean) => void;

  setState: (id: string, state: ItemState) => Promise<void>;
  setNotes: (id: string, notes: string) => Promise<void>;
  toggleState: (id: string, state: ItemState) => Promise<void>;
  syncAll: () => Promise<void>;
  syncOne: (source: string) => Promise<void>;
  /** Syncs a specific set of sources — used by a domain group ("Sync all 3"). */
  syncGroup: (sourceIds: string[]) => Promise<void>;
  connectSource: (source: SourceConnection) => Promise<void>;
  disconnectSource: (source: SourceConnection) => Promise<void>;
  updateSourceOptions: (sourceId: string, options: SourceOptions) => Promise<void>;
  regenerateBriefing: () => Promise<void>;
  updateConfig: (config: AppConfig) => Promise<void>;
  loadDemo: () => Promise<void>;
  wipeData: () => Promise<void>;
  exportLibrary: () => Promise<void>;
  importLibrary: () => Promise<void>;
  contentLoadingId: string | null;
  fetchItemContent: (id: string) => Promise<void>;
  recordFeedback: (id: string, kind: "more_like_this" | "less_like_this") => Promise<void>;
  addWatchlist: (name: string, query: string) => Promise<void>;
  removeWatchlist: (id: string) => Promise<void>;
  addProject: (name: string, description?: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  saveProject: (project: Project) => Promise<void>;
  updateSchedule: (schedule: PulseSchedule) => Promise<void>;
}

function preferenceScore(item: PulseItem, preferences: SignalPreference[], watchlists: Watchlist[]): number {
  const matches = preferences.filter((preference) =>
    (preference.kind === "topic" && preference.value.toLowerCase() === (item.topic ?? "").toLowerCase()) ||
    (preference.kind === "source" && preference.value.toLowerCase() === item.source.toLowerCase()) ||
    (preference.kind === "field" && preference.value === item.field)
  );
  const watchBoost = watchlists.filter((watchlist) => watchlist.enabled && [item.title, item.body ?? "", item.topic ?? "", ...item.tags].join(" ").toLowerCase().includes(watchlist.query.toLowerCase())).length;
  return matches.reduce((total, preference) => total + preference.weight, 0) + watchBoost * 0.3;
}

function personalize(items: PulseItem[], preferences: SignalPreference[], watchlists: Watchlist[]): PulseItem[] {
  return [...items].sort((a, b) => preferenceScore(b, preferences, watchlists) - preferenceScore(a, preferences, watchlists) || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

/**
 * The shared sync path: skips unconnected sources, records progress, and
 * reports one toast for the whole run. Used by "Sync all" and by a domain
 * group's "Sync all N".
 */
async function runSync(
  get: () => PulseStore,
  set: (partial: Partial<PulseStore>) => void,
  targets: SourceConnection[]
): Promise<void> {
  if (!get().desktop) {
    toast.error("Sync needs the desktop app", "Run `pnpm tauri dev` instead of the browser preview.");
    return;
  }
  if (get().syncing) return;

  set({ syncing: true, syncProgress: null });
  try {
    const enabled = targets.filter((source) => source.enabled !== false);
    const ready = enabled.filter((source) => !requiresProfile(source.source) || source.isConnected);
    const skipped = enabled.filter((source) => requiresProfile(source.source) && !source.isConnected);

    if (ready.length === 0) {
      toast.info("Nothing to sync", "Connect a source in Sources, then try again.");
      return;
    }

    const report = await syncSources(ready, (progress) =>
      set({ syncProgress: progress, syncingSource: progress.id })
    );
    const failures = report.outcomes.filter((outcome) => !outcome.ok);

    const parts = [`${report.newItems} items`, `${report.classified} classified`];
    if (report.previews > 0) parts.push(`${report.previews} previews`);
    if (skipped.length) parts.push(`${skipped.length} skipped (not connected)`);

    if (failures.length === 0) {
      toast.success("Sync complete", parts.join(" · "));
    } else {
      toast.error(
        `Sync finished with ${failures.length} error${failures.length > 1 ? "s" : ""}`,
        `${parts.join(" · ")}. ${failures[0].error ?? ""}`
      );
    }

    await get().refreshSources();
    await get().refresh();
    // The run log is its own table — it must be re-read or it keeps showing
    // whatever it held when the app started.
    await get().refreshRuns();
  } catch (err) {
    toast.error("Sync failed", err instanceof Error ? err.message : String(err));
  } finally {
    set({ syncing: false, syncProgress: null, syncingSource: null });
  }
}

export const usePulse = create<PulseStore>((set, get) => ({
  ready: false,
  desktop: false,
  config: { ...EMPTY_CONFIG },

  items: [],
  todayItems: [],
  newItems: [],
  stats: EMPTY_STATS,
  topicSummary: null,
  resources: [],
  briefing: null,
  sources: [],
  preferences: [],
  watchlists: [],
  projects: [],
  schedule: { id: "default", enabled: false, intervalMinutes: 360, notify: true },

  runs: [],
  lastSyncedAt: null,

  view: "today",
  filters: { ...DEFAULT_FILTERS },
  selectedItemId: null,
  drawerOpen: false,
  paletteOpen: false,

  syncing: false,
  briefingLoading: false,
  syncProgress: null,
  syncingSource: null,

  init: async () => {
    const desktop = isTauriEnv();
    set({ desktop });

    const [config, sources, preferences, watchlists, projects, schedule] = await Promise.all([
      getConfig(), getSources(), getSignalPreferences(), getWatchlists(), getProjects(), getSchedule(),
    ]);
    set({ config, sources, preferences, watchlists, projects, schedule });
    // Establish the shared App Group file immediately. This also lets the
    // widget leave its placeholder state before the first sync finishes.
    void publishWidgetSnapshot([], config.macosWidgetEnabled);
    if (desktop) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("configure_background_scheduler", {
        config: { enabled: schedule.enabled, intervalMinutes: schedule.intervalMinutes },
      });
    }

    await get().refresh();
    await get().refreshSources();
    await get().refreshRuns();
    set({ ready: true });

    // Rich previews for the curated catalog are fetched once and persisted, so
    // they are not awaited — the UI is usable while they stream in.
    void get().refreshPreviews();
  },

  refresh: async () => {
    const { filters } = get();
    const since = startOfToday();
    const [rawItems, stats, topicSummary, resources, briefing, todayItems, newItems, preferences, watchlists, projects, schedule] = await Promise.all([
      queryItems(toQuery(filters)),
      getPulseStats(),
      getTopicSummary(),
      getAllResources(),
      ensureBriefing(),
      // Published today ("what happened today") and collected today ("what
      // Pulse found today") are deliberately separate — a big sync of older
      // stories must not inflate "Today".
      queryItems({ sortBy: "recent", publishedSince: since }),
      queryItems({ sortBy: "recent", collectedSince: since }),
      getSignalPreferences(),
      getWatchlists(),
      getProjects(),
      getSchedule(),
    ]);

    const items = personalize(rawItems, preferences, watchlists);
    const personalizedToday = personalize(todayItems, preferences, watchlists);
    const personalizedNewItems = personalize(newItems, preferences, watchlists);
    set({ items, stats, topicSummary, resources, briefing, todayItems: personalizedToday, newItems: personalizedNewItems, preferences, watchlists, projects, schedule });

    // A sync can collect an item whose publication date predates today. Keep
    // those newly collected items visible in the widget without changing the
    // meaning of the in-app Today view.
    const widgetItems = Array.from(
      new Map(
        [...personalizedToday, ...personalizedNewItems].map((item) => [item.id, item]),
      ).values(),
    );
    void publishWidgetSnapshot(
      widgetItems.slice(0, 8).map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      })),
      get().config.macosWidgetEnabled
    );
  },

  refreshItems: async () => {
    const [items, preferences, watchlists] = await Promise.all([queryItems(toQuery(get().filters)), getSignalPreferences(), getWatchlists()]);
    set({ items: personalize(items, preferences, watchlists), preferences, watchlists });
  },

  refreshSources: async () => {
    const sources = await getSources();
    const updated = await Promise.all(
      sources.map(async (source) => {
        if (source.authType !== "browser_profile" || !source.profileName) return source;
        // Directory existence only tells us Chrome ran once — it is not proof of
        // a login, so it never sets isConnected.
        const exists = await profileExists(source.profileName);
        return { ...source, profileExists: exists };
      })
    );
    set({ sources: updated });
    await saveSources(updated);
  },

  refreshRuns: async () => {
    const runs = await getRuns(300);
    // Runs arrive newest-first, so the first finished sync is the latest one.
    const lastSyncedAt =
      runs.find((run) => run.category === "sync" && run.status === "success")?.finishedAt ?? null;
    set({ runs, lastSyncedAt });
  },

  refreshPreviews: async () => {
    if (!get().desktop) return;
    await fetchCuratedPreviews();
    set({ resources: await getAllResources() });
  },

  setView: (view) => set({ view, selectedItemId: null }),
  setFilter: (patch) => {
    set((state) => ({ filters: { ...state.filters, ...patch } }));
    void get().refreshItems();
  },
  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    void get().refreshItems();
  },
  selectItem: (id) => set({ selectedItemId: id }),
  openDrawer: (id) => set({ drawerOpen: true, selectedItemId: id ?? get().selectedItemId }),
  closeDrawer: () => set({ drawerOpen: false }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  setState: async (id, state) => {
    await updateItemState(id, state);
    await get().refresh();
  },

  setNotes: async (id, notes) => {
    await updateItemNotes(id, notes);
    await get().refresh();
  },

  toggleState: async (id, state) => {
    const item = get().items.find((entry) => entry.id === id);
    const next: ItemState = item?.state === state ? "inbox" : state;
    await get().setState(id, next);
  },

  syncAll: async () => {
    await runSync(get, set, get().sources);
  },

  syncGroup: async (sourceIds) => {
    await runSync(
      get,
      set,
      get().sources.filter((source) => sourceIds.includes(source.id))
    );
  },

  syncOne: async (sourceId) => {
    if (!get().desktop) {
      toast.error("Sync needs the desktop app", "Run `pnpm tauri dev` instead of the browser preview.");
      return;
    }
    // Prefer the row id: several sources share one `source` value (arXiv's
    // categories, Hacker News feed + search), so matching on it alone would
    // sync the wrong one.
    const source =
      get().sources.find((entry) => entry.id === sourceId) ??
      get().sources.find((entry) => entry.source === sourceId);
    if (!source) return;

    set({ syncing: true, syncProgress: null, syncingSource: source.id });
    try {
      const report = await syncSources([source]);
      const outcome = report.outcomes[0];
      if (outcome?.ok) {
        toast.success(`${source.name} synced`, `${outcome.newCount} items · ${report.classified} classified`);
      } else {
        toast.error(`${source.name} failed`, outcome?.error ?? "Unknown error");
      }
      await get().refreshSources();
      await get().refresh();
      await get().refreshRuns();
      if (report.newItems > 0) {
        await get().regenerateBriefing();
      }
    } finally {
      set({ syncing: false, syncProgress: null, syncingSource: null });
    }
  },

  disconnectSource: async (source) => {
    if (!source.profileName) return;
    try {
      const result = await disconnectProfile(source.profileName);
      const next = get().sources.map((entry) =>
        entry.id === source.id
          ? { ...entry, isConnected: false, profileExists: false, lastError: undefined }
          : entry
      );
      set({ sources: next });
      await saveSources(next);
      toast.success(
        `${source.name} disconnected`,
        result.removed ? "The saved browser profile was deleted." : "No saved profile was found."
      );
    } catch (err) {
      toast.error("Could not disconnect", err instanceof Error ? err.message : String(err));
    }
  },

  updateSourceOptions: async (sourceId, options) => {
    // Match on the unique row id when we have one, so editing one arXiv
    // category cannot rewrite the others.
    const byId = get().sources.some((source) => source.id === sourceId);
    const matches = (source: SourceConnection) =>
      byId ? source.id === sourceId : source.source === sourceId;

    const next = get().sources.map((source) =>
      matches(source)
        ? { ...source, options, monitoredChannels: describeOptions({ ...source, options }) }
        : source
    );
    set({ sources: next });
    await saveSources(next);
    toast.success("Source settings saved");
  },

  connectSource: async (source) => {
    if (!source.profileName || !source.siteDomain) return;
    try {
      const message = await launchAuthLogin(source.profileName, source.siteDomain);
      toast.info("Login window opened", message);
    } catch (err) {
      toast.error("Could not open login", err instanceof Error ? err.message : String(err));
    }
  },

  regenerateBriefing: async () => {
    set({ briefingLoading: true });
    try {
      const briefing = await ensureBriefing(true);
      set({ briefing });
    } catch (err) {
      toast.error("Briefing failed", err instanceof Error ? err.message : String(err));
    } finally {
      set({ briefingLoading: false });
    }
  },

  updateConfig: async (config) => {
    try {
      const saved = await persistConfig(config);
      set({ config: saved });
      if (!saved.macosWidgetEnabled) {
        await publishWidgetSnapshot([], false);
      }
      toast.success("Settings saved");
    } catch (err) {
      toast.error("Could not save settings", err instanceof Error ? err.message : String(err));
    }
  },

  recordFeedback: async (id, kind) => {
    const item = get().items.find((entry) => entry.id === id);
    if (!item) return;
    const direction = kind === "more_like_this" ? 1 : -1;
    const dimensions: Array<[SignalPreference["kind"], string | null]> = [["topic", item.topic ?? null], ["source", item.source], ["field", item.field]];
    for (const [dimension, value] of dimensions) if (value) await recordSignalFeedback(dimension, value, direction);
    await get().refresh();
    toast.success(kind === "more_like_this" ? "Signal preference updated" : "Signal de-emphasized", "Pulse will use this feedback in future rankings.");
  },

  addWatchlist: async (name, query) => {
    const watchlist = createWatchlist(name, query);
    if (!watchlist.name || !watchlist.query) return;
    await saveWatchlist(watchlist);
    await get().refresh();
  },

  removeWatchlist: async (id) => {
    await deleteWatchlist(id);
    await get().refresh();
  },

  addProject: async (name, description) => {
    const project = createProject(name, description);
    if (!project.name) return;
    await saveProject(project);
    await get().refresh();
  },

  removeProject: async (id) => {
    await deleteProject(id);
    await get().refresh();
  },

  saveProject: async (project) => {
    await saveProject(project);
    await get().refresh();
  },

  updateSchedule: async (schedule) => {
    await saveSchedule(schedule);
    set({ schedule });
    if (get().desktop) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("configure_background_scheduler", {
        config: { enabled: schedule.enabled, intervalMinutes: schedule.intervalMinutes },
      });
    }
  },

  loadDemo: async () => {
    const count = await loadDemoData();
    await get().refresh();
    toast.success("Demo data loaded", `${count} sample items added.`);
  },

  wipeData: async () => {
    await clearAllData();
    await get().refresh();
    toast.success("Local library cleared");
  },

  contentLoadingId: null,

  fetchItemContent: async (id) => {
    const item = get().items.find((entry) => entry.id === id);
    if (!item) return;

    set({ contentLoadingId: id });
    try {
      const result = await fetchAndSummarize(item);
      const resources = await getAllResources();
      set({ resources });
      await get().refresh();

      const captured = result.capturedResources.length;
      const detail = [
        `${result.characters.toLocaleString()} characters · ${result.engine}`,
        captured > 0 ? `${captured} resource${captured === 1 ? "" : "s"} captured and saved` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      if (result.summary) {
        toast.success("Fetched and summarized", detail);
      } else {
        toast.info("Content captured", `${detail} — summarization was unavailable.`);
      }
    } catch (err) {
      toast.error("Could not fetch content", err instanceof Error ? err.message : String(err));
    } finally {
      set({ contentLoadingId: null });
    }
  },

  exportLibrary: async () => {
    if (!get().desktop) {
      toast.error("Export needs the desktop app");
      return;
    }
    try {
      const payload = await buildLibraryExport();
      const path = await saveLibraryFile(JSON.stringify(payload, null, 2));
      if (!path) return;
      toast.success("Library exported", `${payload.items.length} items written to ${path}`);
    } catch (err) {
      toast.error("Export failed", err instanceof Error ? err.message : String(err));
    }
  },

  importLibrary: async () => {
    if (!get().desktop) {
      toast.error("Import needs the desktop app");
      return;
    }
    try {
      const raw = await pickLibraryFile();
      if (!raw) return;
      const summary = await applyLibraryFile(raw);
      await get().refresh();
      await get().refreshSources();
      toast.success(
        "Library imported",
        `${summary.items} items · ${summary.sources} sources · ${summary.briefings} briefings` +
          (summary.skipped > 0 ? ` · ${summary.skipped} skipped` : "")
      );
    } catch (err) {
      toast.error("Import failed", err instanceof Error ? err.message : String(err));
    }
  },
}));
