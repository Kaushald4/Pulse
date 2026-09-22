/**
 * The library: what has been collected, and everything done to an item.
 */
import type { StateCreator } from "zustand";
import { publishWidgetSnapshot } from "../../lib/config";
import { queryFeedGroups, queryItems, updateItemNotes, updateItemState } from "../../lib/db/items";
import { EMPTY_STATS } from "../../lib/db/rows";
import { getAllResources } from "../../lib/db/resources";
import { getPulseStats, getTopicSummary } from "../../lib/db/stats";
import { ensureBriefing } from "../../lib/pipeline";
import { fetchAndSummarize } from "../../lib/content";
import { fetchCuratedPreviews } from "../../lib/metadata";
import { getFeedFacets } from "../../lib/db/feed-facets";
import { FEED_SEEN_AT, readMarker, writeMarker } from "../../lib/db/markers";
import { diversifyHead, personalize } from "../../lib/feed/ranking";
import { getSignalPreferences, getWatchlists, recordSignalFeedback } from "../../lib/db/personal";
import { startOfToday } from "../../lib/utils";
import { toast } from "../../lib/toast";
import type { PulseFilter, SignalPreference, SortKey } from "../../lib/types";
import { FEED_PAGE_SIZE, toQuery, type ItemsSlice, type PulseStore } from "./types";
import type { FeedGroup } from "../../lib/feed/grouping";

/**
 * "Best" spreads its first screen across sources so one loud feed cannot own
 * the top of the list. The other sorts are already ordered by SQL.
 */
function orderGroups(groups: FeedGroup[], sortBy: SortKey): FeedGroup[] {
  return sortBy === "best" ? diversifyHead(groups) : groups;
}

export const createItemsSlice: StateCreator<PulseStore, [], [], ItemsSlice> = (set, get) => ({
  items: [],
  feedGroups: [],
  facets: null,
  lastSeenAt: null,
  feedLimit: FEED_PAGE_SIZE,
  todayItems: [],
  newItems: [],
  stats: EMPTY_STATS,
  topicSummary: null,
  resources: [],
  briefing: null,
  briefingLoading: false,
  contentLoadingId: null,

  refresh: async () => {
    const { filters } = get();
    const since = startOfToday();
    const [
      rawItems,
      rawGroups,
      facets,
      stats,
      topicSummary,
      resources,
      briefing,
      todayItems,
      newItems,
      preferences,
      watchlists,
    ] = await Promise.all([
      queryItems(toQuery(filters)),
      // One row per story, so the feed does not show the same link three times.
      queryFeedGroups(toQuery(filters)),
      getFeedFacets(toQuery(filters)),
      getPulseStats(),
      getTopicSummary(),
      getAllResources(),
      ensureBriefing(),
      // Published today ("what happened today") and collected today ("Pulse
      // found today") are deliberately separate - a big sync of older stories
      // must not inflate "Today". Both read their whole window rather than one
      // page: a busy day runs past 200, and a list that stopped there silently
      // would under-report what arrived.
      queryItems({ sortBy: "recent", publishedSince: since, limit: null }),
      queryItems({ sortBy: "recent", collectedSince: since, limit: null }),
      getSignalPreferences(),
      getWatchlists(),
    ]);

    const items = personalize(rawItems, preferences, watchlists);
    const personalizedToday = personalize(todayItems, preferences, watchlists);
    const personalizedNewItems = personalize(newItems, preferences, watchlists);
    set({
      items,
      feedGroups: orderGroups(rawGroups, filters.sortBy),
      facets,
      stats,
      topicSummary,
      resources,
      briefing,
      todayItems: personalizedToday,
      newItems: personalizedNewItems,
      preferences,
      watchlists,
    });

    // A sync can collect an item whose publication date predates today. Keep
    // those newly collected items visible in the widget without changing the
    // meaning of the in-app Today view.
    const widgetItems = Array.from(
      new Map([...personalizedToday, ...personalizedNewItems].map((item) => [item.id, item])).values()
    );
    void publishWidgetSnapshot(
      widgetItems.slice(0, 8).map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      })),
      get().config.macosWidgetEnabled
    );
  },

  markFeedSeen: async () => {
    // Only the stored marker moves. The value from this launch stays as it was,
    // so the "new since" section does not empty out under the reader.
    await writeMarker(FEED_SEEN_AT, new Date().toISOString());
  },

  refreshItems: async () => {
    const { filters, feedLimit } = get();
    // Every query that fills the list is asked for the same window, so the rows
    // and the stories they group into never come from different pages.
    const window: PulseFilter = { ...toQuery(filters), limit: feedLimit };
    const [items, rawGroups, facets, preferences, watchlists] = await Promise.all([
      queryItems(window),
      queryFeedGroups(window),
      // Counted across everything, not the window: a count that only saw the
      // loaded rows would just report the page size.
      getFeedFacets(toQuery(filters)),
      getSignalPreferences(),
      getWatchlists(),
    ]);
    set({
      items: personalize(items, preferences, watchlists),
      feedGroups: orderGroups(rawGroups, filters.sortBy),
      facets,
      preferences,
      watchlists,
    });
  },

  loadMoreFeed: async () => {
    const { feedLimit, feedGroups, facets } = get();
    // The counts are the truth about how much there is, so stop once the list
    // holds all of it instead of re-querying for another empty page.
    if (facets && feedGroups.length >= facets.total) return;

    set({ feedLimit: feedLimit + FEED_PAGE_SIZE });
    await get().refreshItems();
  },

  refreshPreviews: async () => {
    if (!get().desktop) return;
    await fetchCuratedPreviews();
    set({ resources: await getAllResources() });
  },

  setState: async (id, state) => {
    await updateItemState(id, state);
    await get().refresh();
  },

  setNotes: async (id, notes) => {
    await updateItemNotes(id, notes);
    await get().refresh();
  },

  toggleState: async (id, state) => {
    const item = get().items.find((entry) => entry.id === id);
    const next = item?.state === state ? "inbox" : state;
    await get().setState(id, next);
  },

  recordFeedback: async (id, kind) => {
    const item = get().items.find((entry) => entry.id === id);
    if (!item) return;
    const direction = kind === "more_like_this" ? 1 : -1;
    const dimensions: Array<[SignalPreference["kind"], string | null]> = [
      ["topic", item.topic ?? null],
      ["source", item.source],
      ["field", item.field],
    ];
    for (const [dimension, value] of dimensions)
      if (value) await recordSignalFeedback(dimension, value, direction);
    await get().refresh();
    toast.success(
      kind === "more_like_this" ? "Signal preference updated" : "Signal de-emphasized",
      "Pulse will use this feedback in future rankings."
    );
  },

  regenerateBriefing: async () => {
    set({ briefingLoading: true });
    try {
      const briefing = await ensureBriefing(true);
      set({ briefing });
    } catch (err) {
      toast.error("Briefing failed", err instanceof Error ? err.message : String(err));
    } finally {
      set({ briefingLoading: false });
    }
  },

  fetchItemContent: async (id) => {
    const item = get().items.find((entry) => entry.id === id);
    if (!item) return;

    set({ contentLoadingId: id });
    try {
      const result = await fetchAndSummarize(item);
      const resources = await getAllResources();
      set({ resources });
      await get().refresh();

      const captured = result.capturedResources.length;
      const detail = [
        `${result.characters.toLocaleString()} characters · ${result.engine}`,
        captured > 0 ? `${captured} resource${captured === 1 ? "" : "s"} captured and saved` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      if (result.summary) {
        toast.success("Fetched and summarized", detail);
      } else {
        toast.info("Content captured", `${detail} - summarization was unavailable.`);
      }
    } catch (err) {
      toast.error("Could not fetch content", err instanceof Error ? err.message : String(err));
    } finally {
      set({ contentLoadingId: null });
    }
  },
});
