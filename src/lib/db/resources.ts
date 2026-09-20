/**
 * The resource catalog: links found across collected items, plus the built-in
 * curated set. Detection itself lives in `lib/resources.ts`.
 */
import type { ExtractedResource, PulseItem, ResourceEntry, ResourcePreview } from "../types";
import { CURATED_RESOURCES } from "../curated-resources";
import { getDatabase, readLocal, writeLocal } from "./client";
import { queryItems } from "./items";
import { getLinkPreviews } from "./link-previews";
import { LS_ITEMS } from "./local-keys";

/**
 * Aggregates detected resources across every item, deduped by URL with a real
 * mention count - the shape journal's `resources` table carries.
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

/** Items published today on the local clock - the briefing's source material. */

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

