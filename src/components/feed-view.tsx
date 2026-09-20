"use client";

import React from "react";
import { FilterX, Inbox, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { EmptyState } from "./empty-state";
import { FeedCard } from "./feed-card";
import { CATEGORY_LABELS, STATE_LABELS } from "../lib/taxonomy";
import { usePulse } from "../store/pulse";
import type { SortKey } from "../lib/types";

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "recent", label: "Recent" },
  { id: "score", label: "Score" },
  { id: "comments", label: "Comments" },
];

export function FeedView() {
  const items = usePulse((state) => state.items);
  const filters = usePulse((state) => state.filters);
  const selectedItemId = usePulse((state) => state.selectedItemId);
  const syncing = usePulse((state) => state.syncing);
  const desktop = usePulse((state) => state.desktop);
  const openDrawer = usePulse((state) => state.openDrawer);
  const setFilter = usePulse((state) => state.setFilter);
  const resetFilters = usePulse((state) => state.resetFilters);
  const syncAll = usePulse((state) => state.syncAll);

  const hasFilters =
    Boolean(filters.query || filters.tag || filters.source) ||
    filters.category !== "all" ||
    filters.field !== "all" ||
    filters.state !== "all";

  const heading =
    filters.tag
      ? `#${filters.tag}`
      : filters.category !== "all"
      ? CATEGORY_LABELS[filters.category]
      : filters.state !== "all"
      ? STATE_LABELS[filters.state]
      : "Feed";

  const [visibleCount, setVisibleCount] = React.useState(30);
  const observerTarget = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setVisibleCount(30);
  }, [filters]);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => prev + 30);
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [items.length]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
            <Badge variant="secondary" className="font-normal tabular-nums">
              {items.length}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {desktop ? "Everything collected from your sources." : "Browser preview — sync is disabled here."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5">
              <FilterX className="size-3.5" />
              Reset
            </Button>
          )}
          <Tabs value={filters.sortBy} onValueChange={(value) => setFilter({ sortBy: value as SortKey })}>
            <TabsList className="h-8">
              {SORTS.map((sort) => (
                <TabsTrigger key={sort.id} value={sort.id} className="px-2.5 text-xs">
                  {sort.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {items.length === 0 ? (
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
              <Button size="sm" onClick={() => void syncAll()} disabled={syncing || !desktop} className="gap-1.5">
                <RefreshCw className={syncing ? "size-3.5 animate-spin" : "size-3.5"} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-2">
          {items.slice(0, visibleCount).map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              isSelected={selectedItemId === item.id}
              onSelect={() => openDrawer(item.id)}
            />
          ))}
          {visibleCount < items.length && (
            <div ref={observerTarget} className="h-10 w-full flex items-center justify-center text-xs text-muted-foreground">
              Loading more...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
