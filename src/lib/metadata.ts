import type { PulseItem } from "./types";
import { isTauriEnv } from "./config";
import { CURATED_RESOURCES } from "./curated-resources";
import {
  applyLinkMetadata,
  applyLinkPreviews,
  getItemsNeedingMetadata,
  getLinkPreviews,
  type LinkPreviewUpdate,
} from "./db/link-previews";

interface LinkMetadata {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  ok: boolean;
  error?: string;
}

export interface PreviewReport {
  enriched: number;
  errors: string[];
}

/**
 * Fetches Open Graph previews for items that have never been checked.
 *
 * The renderer cannot read another site's HTML (CORS), so the fetch happens in
 * the Rust backend. Every attempted item is recorded as checked - including
 * failures - so a dead link is not retried on every sync.
 */
export async function fetchLinkPreviews(limit = 40): Promise<PreviewReport> {
  const pending = await getItemsNeedingMetadata(limit);
  if (pending.length === 0 || !isTauriEnv()) return { enriched: 0, errors: [] };

  let results: LinkMetadata[];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    results = await invoke<LinkMetadata[]>("fetch_link_metadata", {
      urls: pending.map((item: PulseItem) => item.url),
      concurrency: 6,
    });
  } catch (err) {
    return { enriched: 0, errors: [err instanceof Error ? err.message : String(err)] };
  }

  const byUrl = new Map(results.map((entry) => [entry.url, entry]));

  await applyLinkMetadata(
    pending.map((item) => {
      const meta = byUrl.get(item.url);
      return {
        id: item.id,
        imageUrl: meta?.image ?? null,
        siteName: meta?.siteName ?? null,
        linkDescription: meta?.description ?? null,
      };
    })
  );

  return {
    enriched: results.filter((entry) => entry.image).length,
    errors: results
      .filter((entry) => !entry.ok && entry.error)
      .map((entry) => `${entry.url}: ${entry.error}`)
      .slice(0, 3),
  };
}

/** The Rust command caps a single call at 60 URLs. */
const PREVIEW_BATCH = 50;

/**
 * Fetches Open Graph previews for the built-in curated links.
 *
 * These links have no item row, so results are stored in `link_previews` keyed
 * by URL. Already-checked links are skipped, making this a one-time cost per
 * link - enough for the default catalog to render as rich cards.
 */
export async function fetchCuratedPreviews(): Promise<PreviewReport> {
  if (!isTauriEnv()) return { enriched: 0, errors: [] };

  const existing = await getLinkPreviews();
  const pending = CURATED_RESOURCES.map((resource) => resource.url).filter(
    (url) => !existing.has(url)
  );
  if (pending.length === 0) return { enriched: 0, errors: [] };

  const { invoke } = await import("@tauri-apps/api/core");
  let enriched = 0;
  const errors: string[] = [];

  for (let start = 0; start < pending.length; start += PREVIEW_BATCH) {
    const batch = pending.slice(start, start + PREVIEW_BATCH);
    let results: LinkMetadata[];
    try {
      results = await invoke<LinkMetadata[]>("fetch_link_metadata", { urls: batch, concurrency: 6 });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      break;
    }

    const updates: LinkPreviewUpdate[] = results.map((entry) => ({
      url: entry.url,
      title: entry.title ?? null,
      description: entry.description ?? null,
      image: entry.image ?? null,
      siteName: entry.siteName ?? null,
    }));
    await applyLinkPreviews(updates);
    enriched += results.filter((entry) => entry.image).length;
    errors.push(
      ...results
        .filter((entry) => !entry.ok && entry.error)
        .map((entry) => `${entry.url}: ${entry.error}`)
    );
  }

  return { enriched, errors: errors.slice(0, 3) };
}
