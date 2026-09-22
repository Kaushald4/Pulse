"use client";

import React from "react";
import { Bell, Eye, Plus, Trash2, ThumbsDown, ThumbsUp, Monitor, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { SectionIntro } from "./shared";
import { usePulse } from "../../store/pulse";
import { formatRelativeTime } from "../../lib/utils";
import type { PulseSchedule } from "../../lib/types";

export function PersonalSection() {
  const watchlists = usePulse((state) => state.watchlists);
  const preferences = usePulse((state) => state.preferences);
  const schedule = usePulse((state) => state.schedule);
  const config = usePulse((state) => state.config);
  const desktop = usePulse((state) => state.desktop);
  const addWatchlist = usePulse((state) => state.addWatchlist);
  const removeWatchlist = usePulse((state) => state.removeWatchlist);
  const removePreference = usePulse((state) => state.removePreference);
  const clearPreferences = usePulse((state) => state.clearPreferences);
  const updateSchedule = usePulse((state) => state.updateSchedule);
  const updateConfig = usePulse((state) => state.updateConfig);
  const [name, setName] = React.useState("");
  const [query, setQuery] = React.useState("");

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !query.trim()) return;
    await addWatchlist(name, query);
    setName("");
    setQuery("");
  };

  const patchSchedule = (patch: Partial<PulseSchedule>) => void updateSchedule({ ...schedule, ...patch });

  return (
    <div className="space-y-5">
      <SectionIntro title="Personal signal">
        Teach Pulse what deserves more attention, keep explicit topics close, and automate collection on a
        schedule.
      </SectionIntro>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Eye className="size-4 text-primary" />
            Watchlists
          </CardTitle>
          <CardDescription>
            Matching items receive a small ranking boost. Watchlists are local and can be broad phrases or
            exact technologies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={(event) => void add(event)} className="flex flex-wrap gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              className="min-w-32 flex-1"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search phrase, e.g. WebGPU"
              className="min-w-48 flex-[2]"
            />
            <Button type="submit" className="gap-1.5">
              <Plus className="size-3.5" />
              Add watchlist
            </Button>
          </form>
          {watchlists.length > 0 && (
            <div className="divide-y divide-border rounded-md border border-border">
              {watchlists.map((watchlist) => (
                <div key={watchlist.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{watchlist.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      matching “{watchlist.query}”
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${watchlist.name}`}
                    title="Delete watchlist"
                    onClick={() => void removeWatchlist(watchlist.id)}
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Monitor className="size-4 text-primary" />Native macOS widget</CardTitle>
          <CardDescription>Publish today’s signal to the real macOS WidgetKit widget. The widget is managed from macOS Desktop &amp; Dock settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={config.macosWidgetEnabled}
              disabled={!desktop}
              onChange={(event) => void updateConfig({ ...config, macosWidgetEnabled: event.target.checked })}
            />
            <span>
              <span className="block">Keep the native widget updated</span>
              <span className="block text-[11px] text-muted-foreground">
                {!desktop ? "Available in the installed desktop app." : "Turning this off stops publishing new widget data."}
              </span>
            </span>
          </label>
        </CardContent>
      </Card> */}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Learned preferences</CardTitle>
          <CardDescription>
            Use “More like this” or “Less like this” in the reader. Pulse keeps the evidence and adjusts
            future ranking without changing the classifier’s raw score.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {preferences.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No feedback yet. Your first few decisions will appear here.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {preferences.slice(0, 18).map((preference) => (
                  <span
                    key={preference.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border py-1 pl-2 pr-1 text-[11px]"
                  >
                    <span className={preference.weight >= 0 ? "text-success" : "text-destructive"}>
                      {preference.weight >= 0 ? (
                        <ThumbsUp className="inline size-3" />
                      ) : (
                        <ThumbsDown className="inline size-3" />
                      )}
                    </span>
                    {preference.value}
                    <span className="text-muted-foreground">{preference.evidence}×</span>
                    <button
                      type="button"
                      onClick={() => void removePreference(preference.id)}
                      aria-label={`Delete the learned preference for ${preference.value}`}
                      title={`Delete the learned preference for ${preference.value}`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>

              {preferences.length > 18 && (
                <p className="text-[11px] text-muted-foreground">
                  Showing 18 of {preferences.length}. Delete these, or clear them all.
                </p>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete every learned preference? Ranking falls back to the classifier's own scores, and your watchlists are kept. This cannot be undone."
                    )
                  ) {
                    void clearPreferences();
                  }
                }}
              >
                Delete all learned preferences
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bell className="size-4 text-primary" />
            Scheduled sync
          </CardTitle>
          <CardDescription>
            Pulse checks the schedule while the tray app is running, syncs enabled sources, and can send a
            native notification when it finishes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(event) => patchSchedule({ enabled: event.target.checked })}
            />
            Enable scheduled sync
          </label>
          <Select
            value={String(schedule.intervalMinutes)}
            onValueChange={(value) =>
              patchSchedule({
                intervalMinutes: Number(value) as PulseSchedule["intervalMinutes"],
              })
            }
          >
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="180">Every 3 hours</SelectItem>
              <SelectItem value="360">Every 6 hours</SelectItem>
              <SelectItem value="720">Every 12 hours</SelectItem>
              <SelectItem value="1440">Once a day</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={schedule.notify}
              onChange={(event) => patchSchedule({ notify: event.target.checked })}
            />
            Notify when complete
          </label>
          <NextRun schedule={schedule} desktop={desktop} />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * When the schedule will next run.
 *
 * The time comes from the Rust timer, which is the only thing that knows, and the
 * label is rebuilt every second rather than stored. A timestamp worked out once
 * and then displayed forever is what used to leave this showing a time in the
 * past; a countdown cannot go stale, and it makes it obvious whether the timer is
 * actually alive.
 */
function NextRun({ schedule, desktop }: { schedule: PulseSchedule; desktop: boolean }) {
  const [, tick] = React.useState(0);

  React.useEffect(() => {
    if (!desktop || !schedule.enabled) return;
    const timer = setInterval(() => tick((count) => count + 1), 1000);
    return () => clearInterval(timer);
  }, [desktop, schedule.enabled]);

  if (!desktop) {
    return <span className="text-[11px] text-muted-foreground">Scheduling runs in the desktop app</span>;
  }

  if (!schedule.enabled) {
    return <span className="text-[11px] text-muted-foreground">Not scheduled</span>;
  }

  if (!schedule.nextRunAt) {
    return <span className="text-[11px] text-muted-foreground">Waiting for the timer</span>;
  }

  const due = new Date(schedule.nextRunAt).getTime();
  const remaining = due - Date.now();
  const clock = new Date(due).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <span className="text-[11px] text-muted-foreground">
      Next run {remaining > 0 ? `in ${formatCountdown(remaining)}` : "any moment now"} ({clock})
      {schedule.lastRunAt && <> · last run {formatRelativeTime(schedule.lastRunAt)}</>}
    </span>
  );
}

/** Counts down in the two largest units that still say something useful. */
function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${seconds}s`;
}
