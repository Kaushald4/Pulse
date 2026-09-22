/**
 * Ranking items for the reader.
 *
 * Pure functions over plain data: what the store feeds it and what the feed
 * ranks with. Kept out of the store so the rules can be tested on their own and
 * reused by the feed's sections.
 */
import type { PulseItem, SignalPreference, Watchlist } from "../types";

/**
 * How much the reader's own signals favour this item.
 *
 * Preferences match on topic, source or field; watchlists add a smaller boost
 * per match, so an explicit preference still outranks a lucky keyword hit.
 */
export function preferenceScore(
  item: PulseItem,
  preferences: SignalPreference[],
  watchlists: Watchlist[]
): number {
  const matches = preferences.filter(
    (preference) =>
      (preference.kind === "topic" && preference.value.toLowerCase() === (item.topic ?? "").toLowerCase()) ||
      (preference.kind === "source" && preference.value.toLowerCase() === item.source.toLowerCase()) ||
      (preference.kind === "field" && preference.value === item.field)
  );
  const watchBoost = watchlists.filter(
    (watchlist) =>
      watchlist.enabled &&
      [item.title, item.body ?? "", item.topic ?? "", ...item.tags]
        .join(" ")
        .toLowerCase()
        .includes(watchlist.query.toLowerCase())
  ).length;
  return matches.reduce((total, preference) => total + preference.weight, 0) + watchBoost * 0.3;
}

/** Signals first, then newest, so a preference never hides a whole list. */
export function personalize(
  items: PulseItem[],
  preferences: SignalPreference[],
  watchlists: Watchlist[]
): PulseItem[] {
  return [...items].sort(
    (a, b) =>
      preferenceScore(b, preferences, watchlists) - preferenceScore(a, preferences, watchlists) ||
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}
