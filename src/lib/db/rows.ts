/**
 * Database row → domain object.
 *
 * Every mapper lives together so a column rename is one edit rather than a hunt
 * through the modules that read it.
 */
import type {
  DailyBriefing,
  ExtractedResource,
  ItemState,
  PulseItem,
  PulseStats,
  ResourcePreview,
  SourceConnection,
  SourceOptions,
} from "../types";
import type { RunRecord } from "./runs";
import { safeParse } from "./client";

export const EMPTY_STATS: PulseStats = {
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

export function rowToItem(row: any): PulseItem {
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

export function rowToBriefing(row: any): DailyBriefing {
  return {
    id: row.date,
    date: row.date,
    title: row.title ?? "Daily Briefing",
    summary: row.summary ?? "",
    keyHappenings: safeParse<string[]>(row.key_happenings_json, []),
    sourcesUsed: safeParse<string[]>(row.sources_json, []),
    // Absent on rows written before item tracking existed - treated as stale.
    itemIds: row.item_ids_json === undefined ? undefined : safeParse<string[]>(row.item_ids_json, []),
    model: row.model ?? null,
    generatedAt: row.created_at ?? null,
  };
}


export function rowToPreview(row: any): ResourcePreview {
  return {
    title: row.title ?? null,
    description: row.description ?? null,
    image: row.image ?? null,
  };
}


export function rowToSource(row: any): SourceConnection {
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

export function rowToRun(row: any): RunRecord {
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
