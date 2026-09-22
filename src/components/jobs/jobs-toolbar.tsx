"use client";

import React from "react";
import { Search, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { JOB_STATUS_LABELS, JOB_STATUS_ORDER, type JobFilter, type JobSort } from "../../lib/jobs/types";
import type { JobCounts } from "../../lib/db/jobs";

const SORTS: Array<{ id: JobSort; label: string }> = [
  { id: "postedAt", label: "Newest posted" },
  { id: "createdAt", label: "Recently added" },
  { id: "relevanceScore", label: "Best match" },
];

const SEARCH_DEBOUNCE_MS = 400;

/** The job count on a tab, muted so it never competes with the label. */
function TabCount({ value }: { value: number }) {
  return <span className="ml-1.5 tabular-nums text-muted-foreground">{value}</span>;
}

export function JobsToolbar({
  filter,
  counts,
  onChange,
}: {
  filter: JobFilter;
  counts?: JobCounts;
  onChange: (patch: Partial<JobFilter>) => void;
}) {
  const [query, setQuery] = React.useState(filter.search);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => setQuery(filter.search), [filter.search]);

  const search = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ search: value }), SEARCH_DEBOUNCE_MS);
  };

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setQuery("");
    onChange({ search: "" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        value={filter.status}
        onValueChange={(value) => onChange({ status: value as JobFilter["status"] })}
      >
        <TabsList className="h-8 flex-wrap">
          <TabsTrigger value="all" className="px-2.5 text-xs">
            All
            {counts && <TabCount value={counts.total} />}
          </TabsTrigger>
          {JOB_STATUS_ORDER.map((status) => (
            <TabsTrigger key={status} value={status} className="px-2.5 text-xs">
              {JOB_STATUS_LABELS[status]}
              {counts && <TabCount value={counts[status]} />}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => search(event.target.value)}
          placeholder="Search jobs…"
          aria-label="Search jobs"
          className="h-8 pl-8 pr-8 text-[13px]"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            onClick={clear}
            className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      <Select value={filter.sort} onValueChange={(value) => onChange({ sort: value as JobSort })}>
        <SelectTrigger className="h-8 w-40 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((sort) => (
            <SelectItem key={sort.id} value={sort.id}>
              {sort.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
