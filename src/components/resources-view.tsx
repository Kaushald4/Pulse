"use client";

import React from "react";
import { Package, ExternalLink, Star, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { EmptyState } from "./empty-state";
import { Chip, SourceChip } from "./chip";
import { Favicon, LinkImage, HostLabel, hostnameOf } from "./link-preview";
import { formatNumber, formatRelativeTime } from "../lib/utils";
import {
  RESOURCE_FILTERS,
  RESOURCE_TYPE_LABELS,
  matchesResourceFilter,
  type ResourceFilter,
} from "../lib/resources";
import { openExternal } from "../lib/config";
import { fetchResourcePreviews } from "../lib/metadata";
import { useProgressiveList } from "../lib/use-progressive-list";
import { usePulse } from "../store/pulse";

export function ResourcesView() {
  const resources = usePulse((state) => state.resources);
  const [filter, setFilter] = React.useState<ResourceFilter>("all");

  // Most resources are links mentioned inside items, and nothing had ever
  // fetched a preview for them, which left the cards with a hostname and
  // nothing else. Open the view and a bounded batch fills in; the guard keeps a
  // reload from starting another pass.
  const backfilled = React.useRef(false);
  React.useEffect(() => {
    if (backfilled.current || resources.length === 0) return;
    backfilled.current = true;
    void fetchResourcePreviews(resources.map((entry) => entry.resource.url)).then((report) => {
      if (report.enriched > 0) void usePulse.getState().refresh();
    });
  }, [resources]);

  const counts = React.useMemo(() => {
    const tally: Record<ResourceFilter, number> = {
      all: resources.length,
      github: 0,
      models: 0,
      papers: 0,
      sites: 0,
    };
    for (const entry of resources) {
      for (const candidate of RESOURCE_FILTERS) {
        if (candidate.id === "all") continue;
        if (matchesResourceFilter(entry.resource.type, candidate.id)) tally[candidate.id] += 1;
      }
    }
    return tally;
  }, [resources]);

  const filtered = resources.filter((entry) => matchesResourceFilter(entry.resource.type, filter));

  // Another tab is another list, so the window starts over.
  const { visibleCount, hasMore, sentinelRef } = useProgressiveList(filtered.length, {
    resetKey: filter,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Resources</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Repos, models, papers, and sites from what you&rsquo;ve collected, plus a built-in starter set.
          </p>
        </div>

        <Tabs value={filter} onValueChange={(value) => setFilter(value as ResourceFilter)}>
          <TabsList className="h-8">
            {RESOURCE_FILTERS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 px-2.5 text-xs">
                {tab.label}
                <span className="tabular-nums text-muted-foreground">{counts[tab.id]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title={filter === "all" ? "No resources detected yet" : "Nothing in this tab yet"}
          description={
            filter === "all"
              ? "Resources are pulled automatically from links (repos, models, papers, sites) found in collected content."
              : "Try another tab, or sync more sources to surface links."
          }
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, visibleCount).map(({ resource, mentions, item, curated, preview }) => {
            // Whether the item *is* the resource rather than merely mentioning
            // it. That distinction decides everything below: an item's own page
            // carries the resource's real title and stats, and a link the item is
            // has not been mentioned at all.
            const isSelf = item?.url === resource.url;
            // Repo stats only belong to the repo itself - a post that merely
            // mentions it would otherwise show the post's points as stars.
            const hasStats = resource.type === "repo" && isSelf && (item?.score ?? 0) > 0;
            // The preview is the single source for a resource's own words. This
            // view used to fall back to the mentioning item as well, which is how
            // one roundup post's description appeared on every site it linked to.
            // That rule lives in previewFor now, where it also covers the image.
            const image = preview?.image ?? null;
            const description = preview?.description ?? null;
            // A repo is identified by owner/name; a site reads better by its own
            // title ("Jina AI") than by its bare host. Anything else prefers a
            // fetched preview title, then the title of the item that is the
            // resource, and only then the identifier.
            const heading =
              resource.type === "repo"
                ? (resource.name ?? preview?.title ?? resource.url)
                : (preview?.title ?? (isSelf ? item?.title : null) ?? resource.name ?? resource.url);
            // Don't repeat the host when it already is the heading.
            const showHost = heading !== hostnameOf(resource.url);

            return (
              <Card key={resource.url} className="flex flex-col gap-0 overflow-hidden p-0">
                <LinkImage src={image} fallback />

                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Favicon url={resource.url} />
                    <Chip label={RESOURCE_TYPE_LABELS[resource.type]} />
                  </span>
                  {/* A curated link is never "mentioned", and a link the item is
                      has not been mentioned at all, so neither shows a count. */}
                  {!curated && !isSelf && (
                    <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">
                      {mentions}×
                    </Badge>
                  )}
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-2 p-4 pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-[13px] font-medium leading-5 text-foreground">
                      {heading}
                    </h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Visit resource"
                      onClick={() => void openExternal(resource.url)}
                      className="size-6 shrink-0 text-muted-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>

                  {description && (
                    <p className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">{description}</p>
                  )}

                  {hasStats && item && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1 tabular-nums">
                        <Star className="size-3" />
                        {formatNumber(item.score)}
                      </span>
                      {item.tags[0] && <span>{item.tags[0]}</span>}
                    </div>
                  )}

                  <div className="mt-auto space-y-2 pt-1">
                    {!curated && item && (
                      <div className="flex items-center justify-between gap-2">
                        <SourceChip source={item.source} />
                        <span
                          className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                          title={`Collected ${new Date(item.publishedAt).toLocaleString()}`}
                        >
                          <Clock className="size-3" />
                          <span suppressHydrationWarning>{formatRelativeTime(item.publishedAt)}</span>
                        </span>
                      </div>
                    )}

                    {showHost && (
                      <div className="border-t border-border pt-2">
                        <HostLabel url={resource.url} />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div
          ref={sentinelRef}
          className="h-10 w-full flex items-center justify-center text-xs text-muted-foreground"
        >
          Loading more...
        </div>
      )}
    </div>
  );
}
