/**
 * What a source needs before it can be collected: a saved login for the
 * platforms, nothing at all for the public feeds.
 *
 * Kept apart from the fetcher map in `registry.ts` so these rules are pure
 * functions over a source row, with no browser or database behind them.
 */
import type { SourceConnection } from "../types";

/** Sources that need no login; the profile argument is ignored for them. */
const PUBLIC_SOURCES = new Set([
  "hackernews",
  "lobsters",
  "arxiv",
  "huggingface",
  "devto",
  "producthunt",
  "github",
  "rss",
]);

export function requiresProfile(sourceId: string): boolean {
  return !PUBLIC_SOURCES.has(sourceId);
}

/**
 * Whether a run should attempt this source.
 *
 * A saved profile is the test, not `isConnected`. That flag records the outcome
 * of a sync, so using it as the precondition as well is circular: a source whose
 * first sync has never run is "not connected", gets skipped, and the successful
 * sync that would have set the flag can never happen. Attempting it instead
 * means a stale login fails loudly with its real error, which is the honest
 * answer either way. A profile only exists once a browser has run for this
 * source, so nothing is attempted without one.
 */
export function canSync(source: SourceConnection): boolean {
  return !requiresProfile(source.source) || Boolean(source.profileExists);
}

/** Splits sources into what a run will attempt and what it will leave out. */
export function partitionSyncable(sources: SourceConnection[]): {
  ready: SourceConnection[];
  skipped: SourceConnection[];
} {
  const ready: SourceConnection[] = [];
  const skipped: SourceConnection[] = [];
  for (const source of sources) (canSync(source) ? ready : skipped).push(source);
  return { ready, skipped };
}
