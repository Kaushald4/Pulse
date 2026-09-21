import type { DailyBriefing, PulseItem, SourceConnection, SyncOutcome } from "./types";
import { classifyItems } from "./ai/classify";
import { generateBriefing, generateReasons } from "./ai/llm";
import {
  applyClassifications,
  applyReasons,
  getUnclassifiedItems,
  type ClassificationUpdate,
} from "./db/classification";
import { getBriefing, getBriefingCandidates, saveBriefing, topicsInPool } from "./db/briefings";
import { upsertItems } from "./db/items";
import { finishRun, startRun } from "./db/runs";
import { recordSyncResult } from "./db/sources";
import { fetchSource } from "./sources/registry";
import { fetchLinkPreviews } from "./metadata";

/** Local-time YYYY-MM-DD, so "today" matches the user's calendar. */
export function todayKey(): string {
  return new Date().toLocaleDateString("en-CA");
}

export interface SyncReport {
  outcomes: SyncOutcome[];
  newItems: number;
  classified: number;
  previews: number;
  errors: string[];
}

export interface SyncProgress {
  /** The source row id - unique, unlike `source` which repeats per domain. */
  id: string;
  label: string;
  index: number;
  total: number;
}

/**
 * Fetches each source independently, then classifies everything new. One source
 * failing is recorded against that source and does not abort the batch.
 *
 * Sources run sequentially on purpose: every helmsman invocation launches Chrome
 * against a profile directory, and concurrent runs fight over the profile lock.
 */
export async function syncSources(
  sources: SourceConnection[],
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncReport> {
  const outcomes: SyncOutcome[] = [];
  let newItems = 0;

  for (const [index, source] of sources.entries()) {
    onProgress?.({
      id: source.id,
      label: source.name,
      index: index + 1,
      total: sources.length,
    });

    const runId = await startRun({ category: "sync", label: source.name });

    try {
      const items = await fetchSource(source);
      if (items.length > 0) {
        await upsertItems(items);
        newItems += items.length;
      }
      await recordSyncResult(source.source, { ok: true });
      await finishRun(runId, {
        status: "success",
        items: items.length,
        summary: items.length === 0 ? "No new items" : `${items.length} items collected`,
      });
      outcomes.push({ source: source.source, ok: true, newCount: items.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordSyncResult(source.source, { ok: false, error: message });
      await finishRun(runId, { status: "failed", error: message });
      outcomes.push({ source: source.source, ok: false, newCount: 0, error: message });
    }
  }

  const enrich = await enrichPendingItems();
  const previews = await fetchLinkPreviews();

  return {
    outcomes,
    newItems,
    classified: enrich.classified,
    previews: previews.enriched,
    errors: [...enrich.errors, ...previews.errors],
  };
}

export interface EnrichReport {
  classified: number;
  errors: string[];
  inputTokens: number;
  outputTokens: number;
}

/**
 * Classifies and scores every item Jev has not seen, then writes the
 * "why it matters" line. Re-syncing unchanged items costs nothing because the
 * content hash matches and they never reach this function.
 */
export async function enrichPendingItems(): Promise<EnrichReport> {
  const pending = await getUnclassifiedItems(80);
  if (pending.length === 0) {
    return { classified: 0, errors: [], inputTokens: 0, outputTokens: 0 };
  }

  const runId = await startRun({ category: "classify", label: `${pending.length} items` });

  const classification = await classifyItems(pending);
  const { classifications, errors } = classification;

  if (classifications.size === 0) {
    await finishRun(runId, {
      status: "failed",
      error: errors[0] ?? "No items could be classified",
      provider: classification.provider,
      model: classification.model,
      inputTokens: classification.inputTokens,
      outputTokens: classification.outputTokens,
    });
    return { classified: 0, errors, inputTokens: classification.inputTokens, outputTokens: classification.outputTokens };
  }

  const updates: ClassificationUpdate[] = [];
  const enrichedItems: PulseItem[] = [];

  for (const item of pending) {
    const classification = classifications.get(item.id);
    if (!classification) continue;
    updates.push({
      id: item.id,
      category: classification.category,
      field: classification.field,
      topic: classification.topic,
      signal: classification.signal,
      primarySource: classification.primarySource,
      whyKey: classification.whyKey,
      classifierModel: classification.classifierModel,
      classifierConfidence: classification.classifierConfidence,
      contentHash: classification.contentHash,
      tags: classification.tags,
      extractedResources: classification.extractedResources,
    });
    enrichedItems.push({
      ...item,
      category: classification.category,
      field: classification.field,
      topic: classification.topic,
      signal: classification.signal,
      whyKey: classification.whyKey,
    });
  }

  await applyClassifications(updates);

  const { reasons, usage } = await generateReasons(enrichedItems);
  await applyReasons(reasons);

  await finishRun(runId, {
    status: errors.length > 0 ? "failed" : "success",
    items: updates.length,
    summary: `${updates.length} classified`,
    error: errors.length > 0 ? errors[0] : null,
    provider: classification.provider,
    model: usage.model ?? classification.model,
    inputTokens: classification.inputTokens + usage.inputTokens,
    outputTokens: classification.outputTokens + usage.outputTokens,
  });

  return {
    classified: updates.length,
    errors,
    inputTokens: classification.inputTokens + usage.inputTokens,
    outputTokens: classification.outputTokens + usage.outputTokens,
  };
}

/**
 * Returns today's briefing, generating it on first request. The model narrates;
 * the selection and ordering came from Jev scores and real counts.
 *
 * A saved briefing is reused only while it still covers exactly today's items,
 * so it never keeps narrating yesterday's content after the day rolls over.
 */
export async function ensureBriefing(force = false): Promise<DailyBriefing> {
  const date = todayKey();
  const items = await getBriefingCandidates(16);
  const itemIds = items.map((item) => item.id);

  if (!force) {
    const existing = await getBriefing(date);
    if (existing && sameItems(existing.itemIds, itemIds)) return existing;
  }

  if (items.length === 0) {
    return {
      id: date,
      date,
      title: "Daily Briefing",
      summary: "Nothing collected yet. Run a sync to pull fresh content, or load demo data from Settings.",
      keyHappenings: [],
      sourcesUsed: [],
      itemIds: [],
      model: null,
      generatedAt: null,
    };
  }

  /*
   * Topics are counted from the same items the briefing is written from, not
   * from the weekly "Rising topics" summary. Handing the model week-long counts
   * next to a single day of items left it trying to reconcile two datasets, and
   * it said as much in the briefing.
   */
  const runId = await startRun({ category: "briefing", label: `Briefing ${date}` });
  const draft = await generateBriefing({
    date,
    items,
    topics: topicsInPool(items),
  });

  const briefing: DailyBriefing = {
    id: date,
    date,
    title: "Daily Briefing",
    summary: draft.summary,
    keyHappenings: draft.keyHappenings,
    sourcesUsed: Array.from(new Set(items.map((item) => item.source))),
    itemIds,
    model: draft.model,
    generatedAt: new Date().toISOString(),
  };

  await saveBriefing(briefing);
  await finishRun(runId, {
    status: draft.model ? "success" : "failed",
    items: items.length,
    summary: draft.model ? `Wrote a briefing from ${items.length} items` : "Fell back to the template",
    error: draft.model ? null : "No writing model was reachable",
    model: draft.model,
    inputTokens: draft.inputTokens,
    outputTokens: draft.outputTokens,
  });
  return briefing;
}

/** Whether a saved briefing covers exactly this set of items. */
function sameItems(saved: string[] | undefined, current: string[]): boolean {
  if (!saved || saved.length !== current.length) return false;
  const set = new Set(saved);
  return current.every((id) => set.has(id));
}
