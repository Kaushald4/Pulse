"use client";

import { Inbox, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { EmptyState } from "../empty-state";
import { FeedCard } from "./feed-card";
import { FeedFilterBar } from "./feed-filter-bar";
import { CATEGORY_LABELS, STATE_LABELS } from "../../lib/taxonomy";
import { usePulse } from "../../store/pulse";
import { useProgressiveList } from "../../lib/use-progressive-list";

export function FeedView() {
  // One entry per story rather than per item: several sources carrying the same
  // link collapse into a single card, and the count is stories, not rows.
  const groups = usePulse((state) => state.feedGroups);
  const facets = usePulse((state) => state.facets);
  const filters = usePulse((state) => state.filters);
  const selectedItemId = usePulse((state) => state.selectedItemId);
  const syncing = usePulse((state) => state.syncing);
  const desktop = usePulse((state) => state.desktop);
  const openDrawer = usePulse((state) => state.openDrawer);
  const resetFilters = usePulse((state) => state.resetFilters);
  const syncAll = usePulse((state) => state.syncAll);

  const hasFilters =
    Boolean(filters.query || filters.tag || filters.source) ||
    filters.category !== "all" ||
    filters.field !== "all" ||
    filters.state !== "all" ||
    filters.window !== "all";

  const heading = filters.tag
    ? `#${filters.tag}`
    : filters.category !== "all"
      ? CATEGORY_LABELS[filters.category]
      : filters.state !== "all"
        ? STATE_LABELS[filters.state]
        : "Feed";

  // Another filter is another list, so the window starts over.
  const { visibleCount, hasMore, sentinelRef } = useProgressiveList(groups.length, {
    resetKey: filters,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
            {/* Every story matching the filters, not just the ones fetched so far. */}
            <Badge variant="secondary" className="font-normal tabular-nums">
              {facets?.total ?? groups.length}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {desktop ? "Everything collected from your sources." : "Browser preview - sync is disabled here."}
          </p>
        </div>
      </div>

      <FeedFilterBar />

      {groups.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={hasFilters ? "No items match these filters" : "Your library is empty"}
          description={
            hasFilters
              ? "Try widening the filters, or reset them to see everything."
              : "Sync a source to collect content. Public feeds need no login."
          }
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void syncAll()}
                disabled={syncing || !desktop}
                className="gap-1.5"
              >
                <RefreshCw className={syncing ? "size-3.5 animate-spin" : "size-3.5"} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-2">
          {groups.slice(0, visibleCount).map((group) => (
            <FeedCard
              key={group.key}
              item={group.representative}
              group={group}
              isSelected={selectedItemId === group.representative.id}
              onSelect={() => openDrawer(group.representative.id)}
            />
          ))}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="h-10 w-full flex items-center justify-center text-xs text-muted-foreground"
            >
              Loading more...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
