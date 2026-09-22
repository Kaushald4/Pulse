"use client";

import { X } from "lucide-react";
import { Button } from "../ui/button";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { usePulse } from "../../store/pulse";
import { FIELD_OPTIONS, fieldLabelFor, type WindowKey } from "../../lib/feed/facets";
import { SOURCE_LABELS, labelFor } from "../../lib/taxonomy";
import type { ContentField, SortKey } from "../../lib/types";

/** The sorts the feed offers, best first, which is also the default. */
const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "best", label: "Best" },
  { id: "recent", label: "New" },
  { id: "score", label: "Top score" },
  { id: "comments", label: "Most discussed" },
];

/**
 * The feed's controls, and the filters that are currently on.
 *
 * Every option carries the count of what clicking it returns, computed under
 * the other active filters. An option with nothing behind it is disabled rather
 * than offered and then empty.
 */
export function FeedFilterBar() {
  const filters = usePulse((state) => state.filters);
  const facets = usePulse((state) => state.facets);
  const setFilter = usePulse((state) => state.setFilter);
  const resetFilters = usePulse((state) => state.resetFilters);

  const active: Array<{ label: string; clear: () => void }> = [];
  if (filters.field !== "all") {
    active.push({
      label: fieldLabelFor(filters.field),
      clear: () => setFilter({ field: "all" }),
    });
  }
  if (filters.source) {
    active.push({
      label: labelFor(SOURCE_LABELS, filters.source, filters.source),
      clear: () => setFilter({ source: undefined }),
    });
  }
  if (filters.window !== "all") {
    active.push({
      label: facets?.windows.find((option) => option.value === filters.window)?.label ?? filters.window,
      clear: () => setFilter({ window: "all" }),
    });
  }
  if (filters.tag) active.push({ label: `#${filters.tag}`, clear: () => setFilter({ tag: undefined }) });
  if (filters.query) active.push({ label: `"${filters.query}"`, clear: () => setFilter({ query: "" }) });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.field} onValueChange={(value) => setFilter({ field: value as ContentField })}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by field">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All fields{facets ? ` (${facets.total})` : ""}</SelectItem>
            {FIELD_OPTIONS.map((field) => {
              const count = facets?.fields.find((option) => option.value === field)?.count ?? 0;
              return (
                <SelectItem key={field} value={field} disabled={count === 0}>
                  {fieldLabelFor(field)} ({count})
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select
          value={filters.source ?? "all"}
          onValueChange={(value) => setFilter({ source: value === "all" ? undefined : value })}
        >
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter by source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {(facets?.sources ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label} ({option.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.window} onValueChange={(value) => setFilter({ window: value as WindowKey })}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by time">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(facets?.windows ?? []).map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.value !== "all" && option.count === 0}
              >
                {option.label} ({option.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs
          value={filters.sortBy}
          onValueChange={(value) => setFilter({ sortBy: value as SortKey })}
          className="ml-auto"
        >
          <TabsList className="h-8">
            {SORTS.map((sort) => (
              <TabsTrigger key={sort.id} value={sort.id} className="px-2.5 text-xs">
                {sort.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {active.map((chip) => (
            <Button
              key={chip.label}
              variant="secondary"
              size="sm"
              onClick={chip.clear}
              className="h-6 gap-1 rounded-md px-2 text-[11px] font-normal"
              title={`Clear ${chip.label}`}
            >
              {chip.label}
              <X className="size-3" />
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-6 px-2 text-[11px]">
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
