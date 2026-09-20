/**
 * Fetched page content and its summary, stored on the item so it survives a restart.
 */
import type { PulseItem } from "../types";
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_ITEMS } from "./local-keys";

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

