/**
 * Open Graph previews, keyed by URL.
 *
 * Items keep their own copy on the row (that is what the reader shows), while
 * this table covers links that have no item of their own - the curated catalog.
 */
import type { PulseItem, ResourcePreview } from "../types";
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_ITEMS, LS_LINK_PREVIEWS } from "./local-keys";
import { rowToItem, rowToPreview } from "./rows";

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
 * Records a preview fetch for each URL - including failures, so a dead link is
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
