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
 * Fetches and stores URL-keyed previews for URLs that have never been checked.
 *
 * Already-checked links are skipped, and because `applyLinkPreviews` records
 * failures too, this is a one-time cost per URL rather than a retry on every
 * launch.
 */
async function previewUrls(pending: string[]): Promise<PreviewReport> {
  if (pending.length === 0 || !isTauriEnv()) return { enriched: 0, errors: [] };

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
      ...results.filter((entry) => !entry.ok && entry.error).map((entry) => `${entry.url}: ${entry.error}`)
    );
  }

  return { enriched, errors: errors.slice(0, 3) };
}

/**
 * Fetches Open Graph previews for the built-in curated links.
 *
 * These links have no item row, so results are stored in `link_previews` keyed
 * by URL. Enough for the default catalog to render as rich cards.
 */
export async function fetchCuratedPreviews(): Promise<PreviewReport> {
  const existing = await getLinkPreviews();
  const pending = CURATED_RESOURCES.map((resource) => resource.url).filter((url) => !existing.has(url));
  return previewUrls(pending);
}

/**
 * Fetches Open Graph previews for resources extracted from collected content.
 *
 * A resource is normally a link mentioned inside an item, so it has no item row
 * of its own and the URL-keyed table never covered it. That is most of the
 * catalog, which is why those cards showed a hostname and nothing else. Called
 * with a bounded slice, so each pass covers a little more.
 */
export async function fetchResourcePreviews(urls: string[], limit = PREVIEW_BATCH): Promise<PreviewReport> {
  const existing = await getLinkPreviews();
  const pending = urls.filter((url) => !existing.has(url)).slice(0, limit);
  return previewUrls(pending);
}
