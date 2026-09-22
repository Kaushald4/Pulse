/**
 * The store's shape, split by slice.
 *
 * Every slice interface is declared here so the composed store in `index.ts`
 * stays a list of names rather than a second copy of every signature.
 */
import type { SyncProgress } from "../../lib/pipeline";
import type { FeedGroup } from "../../lib/feed/grouping";
import type { FeedFacets, WindowKey } from "../../lib/feed/facets";
import { windowSince } from "../../lib/feed/facets";
import type { RunRecord } from "../../lib/db/runs";
import type {
  AppConfig,
  ContentField,
  DailyBriefing,
  ItemCategory,
  ItemState,
  Project,
  PulseFilter,
  PulseItem,
  PulseSchedule,
  PulseStats,
  ResourceEntry,
  SignalPreference,
  SortKey,
  SourceConnection,
  SourceOptions,
  TopicSummary,
  Watchlist,
} from "../../lib/types";
import type { ScheduleDue } from "../../lib/schedule";

export type NavigationTab =
  "today" | "feed" | "resources" | "projects" | "jobs" | "sources" | "logs" | "settings";

export interface Filters {
  category: ItemCategory;
  field: ContentField;
  /** "all" means no triage filter - otherwise a category and a state would
   *  silently intersect and hide items the sidebar count promised. */
  state: ItemState | "all";
  source?: string;
  query: string;
  tag?: string;
  sortBy: SortKey;
  /** How far back to look. Translated into `publishedSince` by `toQuery`. */
  window: WindowKey;
}

/**
 * How many stories one page of the feed holds.
 *
 * Also the step the feed grows by, so reading on is the same request as the
 * first one, only wider.
 */
export const FEED_PAGE_SIZE = 200;

export const DEFAULT_FILTERS: Filters = {
  category: "all",
  field: "all",
  state: "all",
  query: "",
  sortBy: "best",
  window: "all",
};

/** The store's filters, translated into a DB query. */
export function toQuery(filters: Filters): PulseFilter {
  return {
    category: filters.category,
    field: filters.field,
    state: filters.state === "all" ? undefined : filters.state,
    source: filters.source,
    query: filters.query,
    tag: filters.tag,
    sortBy: filters.sortBy,
    publishedSince: windowSince(filters.window),
  };
}

/** Startup: read the stored settings, arm the timer, then load the library. */
export interface BootstrapSlice {
  ready: boolean;
  desktop: boolean;
  init: () => Promise<void>;
}

/** The library: what has been collected, and everything done to an item. */
export interface ItemsSlice {
  items: PulseItem[];
  /** The same items, one row per story rather than one per source. */
  feedGroups: FeedGroup[];
  /**
   * Counts for the filter bar, each computed under the other active filters so
   * a number always equals what clicking it returns. Null until first loaded.
   */
  facets: FeedFacets | null;
  /**
   * When the feed was last opened, as of this launch.
   *
   * Read once at startup and deliberately not refreshed: opening the feed
   * records the new time, and re-reading it would empty the "new since" section
   * while the reader is looking at it.
   */
  lastSeenAt: string | null;
  /** How many stories the list currently holds. Grows as the reader reads on. */
  feedLimit: number;
  /** Items published today on the local clock - resets at local midnight. */
  todayItems: PulseItem[];
  /** Items *collected* today (first seen), whenever they were published. */
  newItems: PulseItem[];
  stats: PulseStats;
  topicSummary: TopicSummary | null;
  resources: ResourceEntry[];
  briefing: DailyBriefing | null;
  briefingLoading: boolean;
  contentLoadingId: string | null;

  refresh: () => Promise<void>;
  /** Records that the feed has been looked at, for the next visit. */
  markFeedSeen: () => Promise<void>;
  /** Widens the list by one page, for reading past what is already loaded. */
  loadMoreFeed: () => Promise<void>;
  /** Re-queries only the item list - for filter changes, which change nothing else. */
  refreshItems: () => Promise<void>;
  /** Fetches Open Graph previews for links that don't have them yet. */
  refreshPreviews: () => Promise<void>;

  setState: (id: string, state: ItemState) => Promise<void>;
  setNotes: (id: string, notes: string) => Promise<void>;
  toggleState: (id: string, state: ItemState) => Promise<void>;
  fetchItemContent: (id: string) => Promise<void>;
  recordFeedback: (id: string, kind: "more_like_this" | "less_like_this") => Promise<void>;
  regenerateBriefing: () => Promise<void>;
}

/** What the app is showing: the view, the filters, the selection, the overlays. */
export interface ViewSlice {
  view: NavigationTab;
  filters: Filters;
  selectedItemId: string | null;
  drawerOpen: boolean;
  paletteOpen: boolean;

  setView: (view: NavigationTab) => void;
  setFilter: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  selectItem: (id: string | null) => void;
  openDrawer: (id?: string) => void;
  closeDrawer: () => void;
  setPaletteOpen: (open: boolean) => void;
}

/** Collecting: the sources, the sync runs, and the log of them. */
export interface SyncSlice {
  sources: SourceConnection[];
  syncing: boolean;
  /** Which source the running sync is on, for visible progress. */
  syncProgress: SyncProgress | null;
  /** The one source whose spinner should be active. */
  syncingSource: string | null;
  /** The audit log: every recorded operation, newest first. */
  runs: RunRecord[];
  /** When the most recent successful sync finished, for "last synced at". */
  lastSyncedAt: string | null;

  refreshSources: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  syncAll: () => Promise<void>;
  syncOne: (source: string) => Promise<void>;
  /** Syncs a specific set of sources - used by a domain group ("Sync all 3"). */
  syncGroup: (sourceIds: string[]) => Promise<void>;
  connectSource: (source: SourceConnection) => Promise<void>;
  disconnectSource: (source: SourceConnection) => Promise<void>;
  updateSourceOptions: (sourceId: string, options: SourceOptions) => Promise<void>;
}

/** What the reader has taught Pulse, and what they are working on. */
export interface PersonalSlice {
  preferences: SignalPreference[];
  watchlists: Watchlist[];
  projects: Project[];

  addWatchlist: (name: string, query: string) => Promise<void>;
  removeWatchlist: (id: string) => Promise<void>;
  addProject: (name: string, description?: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  saveProject: (project: Project) => Promise<void>;
}

export interface ScheduleSlice {
  schedule: PulseSchedule;
  updateSchedule: (schedule: PulseSchedule) => Promise<void>;
  /**
   * Records what the timer reported when it fired. `ran` is false when a sync was
   * already in flight and this firing was covered by it: the timer has moved on
   * either way, so its next run is always recorded, but the schedule must not
   * claim to have run something it skipped.
   */
  reportScheduleRun: (due: ScheduleDue, ran: boolean) => Promise<void>;
}

/** Settings, and the whole-library operations that sit beside them. */
export interface SettingsSlice {
  config: AppConfig;
  updateConfig: (config: AppConfig) => Promise<void>;
  loadDemo: () => Promise<void>;
  wipeData: () => Promise<void>;
  exportLibrary: () => Promise<void>;
  importLibrary: () => Promise<void>;
}

export interface PulseStore
  extends BootstrapSlice, ItemsSlice, ViewSlice, SyncSlice, PersonalSlice, ScheduleSlice, SettingsSlice {}
