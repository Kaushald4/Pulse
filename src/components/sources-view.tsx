"use client";

import React from "react";
import { Globe, Loader2, Lock, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { EmptyState } from "./empty-state";
import { cn } from "../lib/utils";
import { groupSourcesByDomain } from "../lib/sources/grouping";
import { usePulse } from "../store/pulse";
import { GroupRow } from "./sources/group-row";
import { HelmsmanBanner } from "./sources/helmsman-banner";
import { SingleSourceDetail } from "./sources/single-source-detail";
import { DomainGroupDetail } from "./sources/group-detail";

export function SourcesView() {
  const sources = usePulse((state) => state.sources);
  const syncing = usePulse((state) => state.syncing);
  const syncProgress = usePulse((state) => state.syncProgress);
  const syncAll = usePulse((state) => state.syncAll);

  const groups = React.useMemo(() => groupSourcesByDomain(sources), [sources]);
  const [selectedDomain, setSelectedDomain] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (groups.length === 0) return;
    if (!selectedDomain || !groups.some((group) => group.domain === selectedDomain)) {
      setSelectedDomain(groups[0].domain);
    }
  }, [groups, selectedDomain]);

  const privateGroups = groups.filter((group) =>
    group.sources.some((source) => source.authType === "browser_profile")
  );
  const publicGroups = groups.filter(
    (group) => !group.sources.some((source) => source.authType === "browser_profile")
  );
  const selected = groups.find((group) => group.domain === selectedDomain) ?? groups[0] ?? null;

  const sections = [
    { label: "Private sources", icon: Lock, items: privateGroups },
    { label: "Public feeds", icon: Globe, items: publicGroups },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <HelmsmanBanner />

      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Public feeds need no login. Platform feeds use a saved Chrome profile.
          </p>
        </div>
        <Button size="sm" onClick={() => void syncAll()} disabled={syncing} className="gap-1.5">
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync all"}
        </Button>
      </div>

      {syncing && syncProgress && (
        <Card className="shrink-0 space-y-2 p-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 text-foreground">
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              Syncing <span className="font-medium">{syncProgress.label}</span>
            </span>
            <span className="tabular-nums text-muted-foreground">
              {syncProgress.index} / {syncProgress.total}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round((syncProgress.index / syncProgress.total) * 100)}%` }}
            />
          </div>
        </Card>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No sources yet"
          description="Sources appear here once the app has loaded its default catalog."
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)] lg:overflow-hidden">
          <nav className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {sections.map((section) => {
              if (section.items.length === 0) return null;
              const SectionIcon = section.icon;
              return (
                <div key={section.label} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <SectionIcon className="size-3" aria-hidden />
                    {section.label}
                  </div>
                  <div className="space-y-0.5">
                    {section.items.map((group) => (
                      <GroupRow
                        key={group.domain}
                        group={group}
                        active={group.domain === selected?.domain}
                        onSelect={() => setSelectedDomain(group.domain)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {selected ? (
              selected.sources.length === 1 ? (
                <SingleSourceDetail key={selected.sources[0].id} source={selected.sources[0]} />
              ) : (
                <DomainGroupDetail key={selected.domain} group={selected} />
              )
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
