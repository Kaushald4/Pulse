/**
 * Runs one scan across every configured entry.
 *
 * Each entry is a *different* external host, so the risk isn't hammering one -
 * it's many simultaneous outbound connections looking like a burst.
 * CONCURRENCY bounds how many run at once, JITTER_MS staggers their starts, and
 * MAX_PAGES caps any provider that paginates internally.
 */
import { resolveProvider } from "../providers/_registry.mjs";
import { makeHttpContext } from "./http.mjs";
import { isStale, normalizeJob } from "./normalize.mjs";

const CONCURRENCY = 4;
const JITTER_MS = 400;
const MAX_PAGES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processEntry(entry, providers, ctx) {
  const base = { entry: entry.name, provider: null, jobs: [], seen: [], error: null };
  const resolved = resolveProvider(entry, providers);

  if (!resolved) {
    return {
      ...base,
      error: `no provider matched "${entry.name}" - set a provider id or a recognizable careers_url`,
    };
  }
  if ("error" in resolved) return { ...base, error: resolved.error };

  const provider = resolved.provider;

  try {
    const jobs = await provider.fetch(entry, ctx);
    const seen = [];
    const drafts = [];

    for (const job of jobs) {
      // The provider contract requires both; skip malformed rows rather than
      // failing the whole entry.
      if (!job.title?.trim() || !job.url?.trim()) continue;

      // Collected before the age filter: staleness-by-age and
      // closed-by-disappearance are independent signals, so an old listing
      // that is still live must still count as "seen".
      seen.push(job.url);
      if (isStale(job.postedAt)) continue;
      drafts.push(normalizeJob(job, provider.id, entry.name));
    }

    return { ...base, provider: provider.id, jobs: drafts, seen };
  } catch (err) {
    return { ...base, provider: provider.id, error: err?.message ?? String(err) };
  }
}

export async function runEntries(entries, providers, { maxPages = MAX_PAGES, onEntry } = {}) {
  const ctx = { ...makeHttpContext(), maxPages, sleep };
  const results = [];

  // Bounded-concurrency pool with a small startup jitter per task: polite (no
  // thundering herd) without being slow (still CONCURRENCY entries in flight).
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= entries.length) return;
      await sleep(Math.random() * JITTER_MS);
      const result = await processEntry(entries[index], providers, ctx);
      results[index] = result;
      // Reported the moment it lands, so the UI can show real progress.
      onEntry?.(result);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker())
  );
  return results;
}
