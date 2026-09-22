"use client";

import React from "react";
import {
  Newspaper,
  Layers,
  Bookmark,
  Sparkles,
  ArrowRight,
  Flame,
  RefreshCw,
  Inbox,
  Clock,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Chip } from "./chip";
import { StatTile } from "./stat-tile";
import { EmptyState } from "./empty-state";
import { FeedCard } from "./feed/feed-card";
import { usePulse } from "../store/pulse";
import { formatRelativeTime } from "../lib/utils";
import type { ContentField } from "../lib/types";

/** Two independent questions: what happened today, vs what Pulse found today. */
type Basis = "published" | "collected";

export function DashboardView() {
  const briefing = usePulse((state) => state.briefing);
  const todayItems = usePulse((state) => state.todayItems);
  const newItems = usePulse((state) => state.newItems);
  const lastSyncedAt = usePulse((state) => state.lastSyncedAt);
  const topicSummary = usePulse((state) => state.topicSummary);
  const selectedItemId = usePulse((state) => state.selectedItemId);
  const briefingLoading = usePulse((state) => state.briefingLoading);
  const openDrawer = usePulse((state) => state.openDrawer);
  const setFilter = usePulse((state) => state.setFilter);
  const setView = usePulse((state) => state.setView);
  const regenerateBriefing = usePulse((state) => state.regenerateBriefing);
  const sources = usePulse((state) => state.sources);
  const stats = usePulse((state) => state.stats);
  const config = usePulse((state) => state.config);

  // "Today" is the local calendar day - it resets at local midnight, not after
  // a rolling 24 hours, so nothing from yesterday lingers once the clock rolls.
  const [basis, setBasis] = React.useState<Basis>("published");
  const [field, setField] = React.useState<ContentField>("all");

  const basisItems = basis === "published" ? todayItems : newItems;
  const basisLabel = basis === "published" ? "Today" : "New to Pulse";

  const counts = React.useMemo(() => {
    const tally: Record<string, number> = { all: basisItems.length };
    for (const item of basisItems) tally[item.field] = (tally[item.field] ?? 0) + 1;
    return tally;
  }, [basisItems]);

  const savedOrImportant = React.useMemo(
    () => basisItems.filter((item) => item.state === "saved" || item.state === "important").length,
    [basisItems]
  );

  const topItems = (field === "all" ? basisItems : basisItems.filter((item) => item.field === field)).slice(
    0,
    8
  );

  const fieldTabs: Array<{ id: ContentField; label: string; count: number }> = [
    { id: "all", label: "All", count: counts.all ?? 0 },
    { id: "ai_ml", label: "AI & ML", count: counts.ai_ml ?? 0 },
    { id: "systems_infra", label: "Systems", count: counts.systems_infra ?? 0 },
    { id: "web_frontend", label: "Web", count: counts.web_frontend ?? 0 },
    { id: "developer_tools", label: "Dev tools", count: counts.developer_tools ?? 0 },
    { id: "security", label: "Security", count: counts.security ?? 0 },
  ];

  /* Hide the rail entirely rather than rendering filler. */
  const showTopics = (topicSummary?.topics.length ?? 0) > 0;
  const hasModel = Boolean(
    (config.cloudflare?.apiToken && config.cloudflare?.accountId) ||
    config.openrouter?.apiKey ||
    (config.openaiCompatible?.apiKey && config.openaiCompatible?.baseUrl)
  );
  const setupSteps = [
    {
      label: "Connect a source",
      done: sources.some((source) => source.lastSyncAt),
      view: "sources" as const,
    },
    { label: "Configure an AI provider", done: hasModel, view: "settings" as const },
    { label: "Collect your first items", done: stats.total > 0, view: "feed" as const },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {basis === "published"
              ? "Items published today, resets at local midnight."
              : "Items Pulse collected today, whenever they were published."}
          </p>
          <Tabs value={basis} onValueChange={(value) => setBasis(value as Basis)} className="mt-2.5">
            <TabsList className="h-8">
              <TabsTrigger value="published" className="px-2.5 text-xs">
                Published today
              </TabsTrigger>
              <TabsTrigger value="collected" className="px-2.5 text-xs">
                New to Pulse
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastSyncedAt && (
            <span
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title={new Date(lastSyncedAt).toLocaleString()}
              suppressHydrationWarning
            >
              <Clock className="size-3.5" aria-hidden />
              Last synced {formatRelativeTime(lastSyncedAt)}
            </span>
          )}
          {/* {briefing?.date && (
            <Badge variant="outline" className="font-normal tabular-nums">
              {briefing.date}
            </Badge>
          )} */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void regenerateBriefing()}
            disabled={briefingLoading || todayItems.length === 0}
            className="gap-1.5"
          >
            <RefreshCw className={briefingLoading ? "size-3.5 animate-spin" : "size-3.5"} />
            {briefingLoading ? "Summarizing…" : "Regenerate"}
          </Button>
          <Button size="sm" onClick={() => setView("feed")} className="gap-1.5">
            Open feed
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>

      {stats.total === 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Set up your signal desk</CardTitle>
            <p className="text-[13px] leading-5 text-muted-foreground">
              Pulse becomes useful after one source sync. These three steps are enough to get your first
              briefing.
            </p>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            {setupSteps.map((step) => (
              <button
                key={step.label}
                type="button"
                onClick={() => setView(step.view)}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-accent"
              >
                {step.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className={step.done ? "text-muted-foreground line-through" : "text-foreground"}>
                  {step.label}
                </span>
                {!step.done && <ArrowRight className="ml-auto size-3.5 text-muted-foreground" />}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile value={basisItems.length} label="Items" hint={basisLabel} icon={Newspaper} />
        <StatTile value={counts.ai_ml ?? 0} label="AI & ML" hint={basisLabel} icon={Sparkles} />
        <StatTile value={counts.systems_infra ?? 0} label="Systems & infra" hint={basisLabel} icon={Layers} />
        <StatTile value={savedOrImportant} label="Saved & important" hint={basisLabel} icon={Bookmark} />
      </div>

      <div
        className={
          showTopics
            ? "grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]"
            : "grid items-start gap-6"
        }
      >
        <div className="min-w-0 space-y-6">
          {/* The briefing narrates what was published today, so it only makes
              sense on that basis. */}
          {basis === "published" && todayItems.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Daily briefing
              </h2>
              <Card>
                <CardHeader className="gap-2 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm">{briefing?.title ?? "Daily Briefing"}</CardTitle>
                    <div className="flex flex-wrap items-center gap-1">
                      {(briefing?.sourcesUsed ?? []).slice(0, 5).map((source) => (
                        <span key={source} className="text-[11px] text-muted-foreground">
                          {source}
                        </span>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-[13px] leading-6 text-muted-foreground">
                    {briefing?.summary ?? "Loading briefing…"}
                  </p>
                  {(briefing?.keyHappenings?.length ?? 0) > 0 && (
                    <ul className="space-y-2 border-t border-border pt-3">
                      {briefing?.keyHappenings.map((entry, index) => (
                        <li key={index} className="flex items-start gap-2.5 text-[13px] leading-5">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/30" />
                          <span className="text-foreground/90">{entry}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {basis === "published" ? "Published today" : "New to Pulse"}
              </h2>
              <button
                type="button"
                onClick={() => setView("feed")}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                View all
              </button>
            </div>

            <Tabs value={field} onValueChange={(value) => setField(value as ContentField)}>
              <TabsList className="h-8 flex-wrap">
                {fieldTabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 px-2.5 text-xs">
                    {tab.label}
                    <span className="tabular-nums text-muted-foreground">{tab.count}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {topItems.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={
                  basisItems.length > 0
                    ? "Nothing in this category today"
                    : basis === "published"
                      ? "Nothing published today yet"
                      : "Nothing new to Pulse today"
                }
                description={
                  basisItems.length > 0 ? (
                    "Try another category."
                  ) : (
                    <>
                      {basis === "published"
                        ? "Today resets at local midnight. Run a sync to pull today's stories, or load demo data from "
                        : "Nothing has been collected since local midnight. Run a sync, or load demo data from "}
                      <button
                        type="button"
                        onClick={() => setView("settings")}
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        Settings
                      </button>
                      .
                    </>
                  )
                }
              />
            ) : (
              <div className="space-y-2">
                {topItems.map((item) => (
                  <FeedCard
                    key={item.id}
                    item={item}
                    isSelected={selectedItemId === item.id}
                    onSelect={() => openDrawer(item.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {showTopics && (
          <aside className="xl:sticky xl:top-0">
            <Card>
              <CardHeader className="gap-1 pb-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Flame className="size-3.5 text-muted-foreground" />
                  {topicSummary?.hasBaseline ? "Rising this week" : "Most discussed this week"}
                </CardTitle>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {topicSummary?.hasBaseline
                    ? "Last 7 days vs the prior 7"
                    : "Last 7 days - no prior week to compare yet"}
                </p>
              </CardHeader>
              <CardContent className="space-y-0.5">
                {topicSummary?.topics.map((row, index) => (
                  <button
                    key={row.topic}
                    type="button"
                    onClick={() => {
                      setFilter({ tag: row.topic, category: "all" });
                      setView("feed");
                    }}
                    className="block w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                        {row.topic}
                      </span>
                      {row.delta && (
                        <span
                          className={
                            row.rising
                              ? "shrink-0 text-[11px] tabular-nums text-success"
                              : "shrink-0 text-[11px] tabular-nums text-muted-foreground"
                          }
                        >
                          {row.delta}
                        </span>
                      )}
                      <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {row.count}
                      </span>
                    </div>
                    <div className="mt-1.5 ml-5.5 h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-foreground/30"
                        style={{ width: `${Math.round(row.momentum * 100)}%` }}
                      />
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}
