/**
 * Ranking items for the reader.
 *
 * Pure functions over plain data: what the store feeds it and what the feed
 * ranks with. Kept out of the store so the rules can be tested on their own and
 * reused by the feed's sections.
 */
import type { PulseItem, SignalPreference, Watchlist } from "../types";
import type { FeedGroup } from "./grouping";

/** How many items one source may contribute before the cap defers it. */
export const MAX_PER_SOURCE = 3;

/** How many stories the feed shows before the reader scrolls. */
export const FIRST_SCREEN = 30;

/**
 * Spreads the first screen across sources.
 *
 * Only the head. Further down, plain rank order is more useful than an
 * artificial spread, because by then a reader is looking for depth on one
 * subject rather than breadth across many, and a cap applied to the whole list
 * would bury a source's fourth story behind everything else in the library.
 */
export function diversifyHead(groups: FeedGroup[], size = FIRST_SCREEN): FeedGroup[] {
  if (groups.length <= size) return groups;

  const head = diversify(groups, {
    limit: size,
    sourceOf: (group) => group.representative.source,
    keyOf: (group) => group.key,
  });
  const taken = new Set(head.map((group) => group.key));
  return [...head, ...groups.filter((group) => !taken.has(group.key))];
}

/**
 * How much attention an item got, on one scale.
 *
 * Comments weigh double: a thread means people cared enough to reply, while a
 * vote is one click. Logarithmic so a single 5,000-point post cannot make
 * everything else look dead.
 */
export function engagement(item: { score: number; commentsCount: number }): number {
  return Math.log1p(Math.max(0, item.score) + Math.max(0, item.commentsCount) * 2);
}

/**
 * Classifier score when there is one, engagement otherwise.
 *
 * Both classifier engines write `signal`, so this is not engine-specific. It
 * falls back for the window before a classifier has run over an item: a fresh
 * sync, a partial failure, or no provider key configured yet. Scoring is
 * incremental, so part of a pool having a score is normal rather than an edge
 * case.
 */
export function byImportance(a: PulseItem, b: PulseItem): number {
  const aScored = typeof a.signal === "number";
  const bScored = typeof b.signal === "number";
  if (aScored !== bScored) return aScored ? -1 : 1;
  if (aScored && bScored && a.signal !== b.signal) {
    return (b.signal as number) - (a.signal as number);
  }
  return engagement(b) - engagement(a);
}

/**
 * Caps how many entries one source may contribute, then tops up in rank order
 * if the pool is too narrow to fill the budget.
 *
 * Without the cap a single fast-moving feed takes every slot: on a busy Reddit
 * day all sixteen briefing candidates were Reddit threads, which is why the
 * briefing had nothing technical to say.
 */
export function diversify<T>(
  ranked: T[],
  options: {
    limit: number;
    sourceOf: (entry: T) => string;
    keyOf: (entry: T) => string;
    maxPerSource?: number;
  }
): T[] {
  const { limit, sourceOf, keyOf, maxPerSource = MAX_PER_SOURCE } = options;
  const chosen: T[] = [];
  const perSource = new Map<string, number>();

  for (const entry of ranked) {
    if (chosen.length === limit) return chosen;
    const used = perSource.get(sourceOf(entry)) ?? 0;
    if (used >= maxPerSource) continue;
    perSource.set(sourceOf(entry), used + 1);
    chosen.push(entry);
  }

  if (chosen.length < limit) {
    const taken = new Set(chosen.map(keyOf));
    for (const entry of ranked) {
      if (chosen.length === limit) break;
      if (taken.has(keyOf(entry))) continue;
      chosen.push(entry);
    }
  }

  return chosen;
}

/**
 * Whether a watchlist matches an item.
 *
 * The one place that decides this, so the feed's section and the ranking boost
 * cannot disagree about what a watchlist caught.
 */
export function matchesWatchlist(item: PulseItem, watchlist: Watchlist): boolean {
  if (!watchlist.enabled) return false;
  return [item.title, item.body ?? "", item.topic ?? "", ...item.tags]
    .join(" ")
    .toLowerCase()
    .includes(watchlist.query.toLowerCase());
}

/** The watchlists an item matches. */
export function matchedWatchlists(item: PulseItem, watchlists: Watchlist[]): Watchlist[] {
  return watchlists.filter((watchlist) => matchesWatchlist(item, watchlist));
}

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
  // Through the shared matcher, so the boost and the watchlist section agree.
  const watchBoost = matchedWatchlists(item, watchlists).length;
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
