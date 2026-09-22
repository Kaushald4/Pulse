import type { ResourceType } from "./resources";

export type ItemCategory = "all" | "repo" | "paper" | "resource" | "news";

export type ContentField =
  "all" | "ai_ml" | "systems_infra" | "web_frontend" | "developer_tools" | "security" | "data" | "other";

/** A concrete field value (everything except the UI-only "all" filter). */
export type ContentFieldValue = Exclude<ContentField, "all">;

export type ItemState = "inbox" | "saved" | "important" | "archived";

export type SortKey = "recent" | "score" | "comments";

export interface ExtractedResource {
  type: ResourceType;
  name: string | null;
  url: string;
}

/** Open Graph data fetched for a link, keyed by URL. */
export interface ResourcePreview {
  title: string | null;
  description: string | null;
  image: string | null;
}

/**
 * A resource shown in the library: either aggregated from collected items, or
 * one of the built-in curated links that ship with the app.
 */
export interface ResourceEntry {
  resource: ExtractedResource;
  mentions: number;
  /** Most recent item that references this resource. Absent for curated links. */
  item?: PulseItem;
  /** A built-in link from the starter catalog - not derived from collected content. */
  curated?: boolean;
  /** Rich link preview: og:image / og:description / og:title, when captured. */
  preview?: ResourcePreview;
}

/** A content item after extraction, classification, and scoring. */
export interface PulseItem {
  id: string;
  source: string;
  sourceType: string;
  category: "repo" | "paper" | "resource" | "news";
  field: ContentField;
  title: string;
  url: string;
  body: string | null;
  author: string | null;
  authorUrl: string | null;
  score: number;
  commentsCount: number;
  publishedAt: string;
  state: ItemState;
  tags: string[];
  extractedResources?: ExtractedResource[];
  createdAt: string;

  /**
   * Classifier output, written by whichever engine the user configured - Jev or
   * the LLM JSON-mode classifier. Nothing here is specific to one of them, and
   * all of it is absent until classification has run over the item.
   */
  topic?: string | null;
  signal?: number | null;
  primarySource?: boolean | null;
  /** The classifier's reason category (e.g. "major-model-release"). */
  whyKey?: string | null;
  /** One-line "why it matters" written by the LLM, or a label fallback. */
  why?: string | null;
  classifierModel?: string | null;
  classifierConfidence?: number | null;
  classifiedAt?: string | null;
  contentHash?: string | null;

  /** Open Graph preview, fetched in Rust at sync time (the renderer can't). */
  imageUrl?: string | null;
  siteName?: string | null;
  linkDescription?: string | null;
  /** Set once a preview fetch has been attempted, so failures aren't retried. */
  linkCheckedAt?: string | null;

  /** Full page content fetched on demand, and the AI summary written from it. */
  contentText?: string | null;
  contentSummary?: string | null;
  contentEngine?: string | null;
  contentFetchedAt?: string | null;
  notes?: string | null;
}

export interface SourceConnection {
  id: string;
  source: string;
  name: string;
  authType: "browser_profile" | "public_api";
  profileName?: string;
  siteDomain?: string;
  /** True only after a sync against this source succeeded. */
  isConnected: boolean;
  /** Live check: the Chrome profile directory exists. Not proof of a login. */
  profileExists?: boolean;
  monitoredChannels: string[];
  /** Per-source extraction settings (subreddits, queries, category, …). */
  options?: SourceOptions;
  lastSyncAt?: string;
  lastError?: string;
  enabled?: boolean;
}

/**
 * Per-source extraction settings. Every field is optional; the fetcher falls
 * back to a sensible default when one is missing.
 */
export interface SourceOptions {
  /** reddit */
  subreddits?: string[];
  sort?: string;
  /** twitter: home timeline, or keyword search */
  mode?: "feed" | "search";
  queries?: string[];
  /** linkedin jobs */
  keywords?: string;
  location?: string;
  /** arxiv category, dev.to tag */
  category?: string;
  tag?: string;
  /** RSS/Atom feed URL */
  feedUrl?: string;
  /** github trending */
  language?: string;
  days?: number;
  /** shared */
  limit?: number;
}

export interface PulseFilter {
  category?: ItemCategory;
  field?: ContentField;
  state?: ItemState;
  source?: string;
  query?: string;
  tag?: string;
  sortBy?: SortKey;
  /** ISO instant lower bound on `published_at` (when the item was published). */
  publishedSince?: string;
  /** ISO instant lower bound on `created_at` (when Pulse collected it). */
  collectedSince?: string;
}

export type FeedbackKind = "more_like_this" | "less_like_this";

export interface SignalPreference {
  id: string;
  kind: "topic" | "source" | "field";
  value: string;
  weight: number;
  evidence: number;
  updatedAt: string;
}

export interface Watchlist {
  id: string;
  name: string;
  query: string;
  enabled: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  itemIds: string[];
}

/** The intervals the Settings picker offers. */
export type ScheduleInterval = 1 | 30 | 60 | 180 | 360 | 720 | 1440;

export interface PulseSchedule {
  id: string;
  enabled: boolean;
  intervalMinutes: ScheduleInterval;
  notify: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export interface PulseStats {
  total: number;
  inbox: number;
  saved: number;
  important: number;
  archived: number;
  repos: number;
  papers: number;
  resources: number;
  news: number;
  aiMl: number;
  systems: number;
  web: number;
  devTools: number;
  security: number;
  data: number;
  other: number;
}

/** One topic in the rising panel, journal-style. */
export interface TopicVelocity {
  topic: string;
  /** Items in the current window. */
  count: number;
  /** Items in the immediately preceding window of the same length. */
  previous: number;
  /** 0..1 relative to the busiest topic, for the bar. */
  momentum: number;
  /** "new" | "+40%" | "0%" - null when there is no prior window to compare. */
  delta: string | null;
  rising: boolean;
}

export interface TopicSummary {
  topics: TopicVelocity[];
  /**
   * False when the prior window has no data, so week-over-week velocity cannot
   * be computed at all. The panel changes its heading rather than labelling
   * every topic "new".
   */
  hasBaseline: boolean;
  windowDays: number;
}

export interface DailyBriefing {
  id: string;
  title: string;
  date: string;
  summary: string;
  keyHappenings: string[];
  sourcesUsed: string[];
  /** Ids of the items this briefing was written from - a saved briefing is
   *  reused only while they still match today's items. */
  itemIds?: string[];
  model?: string | null;
  generatedAt?: string | null;
}

export interface SyncOutcome {
  source: string;
  ok: boolean;
  newCount: number;
  error?: string;
}

export type AiProvider = "cloudflare" | "openrouter" | "openai-compatible";

/** `jev` = TypeSafe System One (Cloudflare only); `llm` = JSON-mode chat model. */
export type ClassifierEngine = "jev" | "llm";

/** Which provider and model serves one task. */
export interface TaskConfig {
  provider: AiProvider;
  model: string;
  engine: ClassifierEngine;
}

/** How a page's full content is fetched for reading and summarisation. */
export type ExtractionEngine = "builtin" | "tinyfish" | "scrapling";

export interface AppConfig {
  /** Whether Pulse should publish data for the native macOS WidgetKit widget. */
  macosWidgetEnabled: boolean;
  cloudflare: { accountId: string; apiToken: string };
  openrouter: { apiKey: string };
  openaiCompatible: { baseUrl: string; apiKey: string };
  classification: TaskConfig;
  generation: TaskConfig;
  extraction: {
    engine: ExtractionEngine;
    tinyfishApiKey: string;
    pythonPath: string;
  };
  /**
   * Job pages have their own engine on purpose: a scan touches hundreds of
   * listings, and the article reader's TinyFish allowance (1,000 pages/day)
   * shouldn't be spent on them. Shares the key and interpreter above.
   */
  jobsExtraction: {
    engine: ExtractionEngine;
  };
  githubToken: string;
}

export interface ProbeResult {
  ok: boolean;
  provider: string;
  model: string;
  detail?: string;
  error?: string;
}
