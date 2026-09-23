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
  // limit: null reads across every item rather than one page. Reading a page
  // made the catalog grow and shrink with whatever synced last, because a sync
  // fills the newest rows and pushes older resource-bearing items out of it.
  const [items, previews] = await Promise.all([queryItems({ limit: null }), getLinkPreviews()]);
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

/**
 * One entry's preview: a captured Open Graph fetch when there is one, otherwise
 * the item's own metadata, but only when the item *is* the resource.
 *
 * A roundup post is one item with a dozen resources, and its description
 * describes the roundup rather than the sites inside it. Borrowing it made
 * futuretools.io, aitools.fyi and huggingface.co all render the same sentence.
 * With nothing true to say about a resource, the honest answer is nothing.
 */
function previewFor(entry: ResourceEntry, previews: Map<string, ResourcePreview>): ResourcePreview {
  const stored = previews.get(entry.resource.url);
  const isSelf = sameUrl(entry.resource.url, entry.item?.url);
  return {
    title: stored?.title ?? null,
    description: stored?.description ?? (isSelf ? itemText(entry) : null),
    image: stored?.image ?? (isSelf ? (entry.item?.imageUrl ?? null) : null),
  };
}

/** The item's own words about itself, in falling order of usefulness. */
function itemText(entry: ResourceEntry): string | null {
  return entry.item?.linkDescription ?? entry.item?.why ?? entry.item?.body ?? null;
}

/**
 * Whether two URLs are the same address, ignoring a trailing slash and host
 * case. Deliberately stricter than the feed's canonicalisation: merging two
 * genuinely different links here would attribute one site's description to
 * another, which is the bug this guards against.
 */
function sameUrl(a: string, b?: string | null): boolean {
  if (!b) return false;
  const strip = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  return strip(a) === strip(b);
}
