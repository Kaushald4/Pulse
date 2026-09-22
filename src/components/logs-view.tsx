"use client";

import React from "react";
import { AlertCircle, AlertTriangle, Coins, ListChecks, Loader2, TrendingUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Chip } from "./chip";
import { StatTile } from "./stat-tile";
import { EmptyState } from "./empty-state";
import { usePulse } from "../store/pulse";
import { cn, formatRelativeTime } from "../lib/utils";
import type { RunCategory, RunStatus } from "../lib/db/runs";

const RANGES = [
  { id: "today", label: "Today", tileLabel: "today" },
  { id: "7d", label: "7 days", tileLabel: "in 7 days" },
  { id: "30d", label: "30 days", tileLabel: "in 30 days" },
  { id: "all", label: "All", tileLabel: "all time" },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const CATEGORIES: Array<{ id: RunCategory | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "sync", label: "Sync" },
  { id: "classify", label: "Classify" },
  { id: "briefing", label: "Briefing" },
  { id: "content", label: "Article" },
  { id: "jobs", label: "Jobs" },
];

const STATUSES: Array<{ id: RunStatus | "all"; label: string }> = [
  { id: "all", label: "Any status" },
  { id: "running", label: "Running" },
  { id: "success", label: "Success" },
  { id: "failed", label: "Failed" },
];

const CATEGORY_LABELS: Record<RunCategory, string> = {
  sync: "Sync",
  classify: "Classify",
  briefing: "Briefing",
  content: "Article",
  jobs: "Jobs",
};

/** Start-of-day for "Today", otherwise a rolling window; "all" has no cutoff. */
function cutoffFor(range: RangeId): number {
  const day = 86_400_000;
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (range === "7d") return Date.now() - 7 * day;
  if (range === "30d") return Date.now() - 30 * day;
  return 0;
}

/**
 * A running row must read as live - a spinner and its own neutral fill - while
 * success and failure borrow the semantic tones, so red always means failure.
 */
function StatusBadge({ status }: { status: RunStatus }) {
  if (status === "running") {
    return <Chip label="Running" icon={Loader2} className="[&_svg]:animate-spin" />;
  }
  if (status === "failed") {
    return <Chip label="Failed" tone="danger" icon={AlertCircle} />;
  }
  return <Chip label="Success" tone="success" />;
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function LogsView() {
  const runs = usePulse((state) => state.runs);
  const refreshRuns = usePulse((state) => state.refreshRuns);

  const [range, setRange] = React.useState<RangeId>("7d");
  const [category, setCategory] = React.useState<RunCategory | "all">("all");
  const [status, setStatus] = React.useState<RunStatus | "all">("all");

  const inRange = React.useMemo(() => {
    const cutoff = cutoffFor(range);
    return runs.filter((run) => new Date(run.startedAt).getTime() >= cutoff);
  }, [runs, range]);

  const byCategory = category === "all" ? inRange : inRange.filter((run) => run.category === category);
  const visible = status === "all" ? byCategory : byCategory.filter((run) => run.status === status);

  const running = byCategory.filter((run) => run.status === "running").length;
  const failures = byCategory.filter((run) => run.status === "failed").length;
  const finished = byCategory.filter((run) => run.status !== "running").length;
  const successRate = finished === 0 ? null : Math.round(((finished - failures) / finished) * 100);
  const tokens = byCategory.reduce((sum, run) => sum + run.inputTokens + run.outputTokens, 0);

  const rangeLabel = RANGES.find((entry) => entry.id === range)?.tileLabel ?? "";

  // Keep running rows honest and relative times fresh: re-read when the view
  // opens, poll hard while a run is live, slowly otherwise.
  const hasRunning = visible.some((run) => run.status === "running");

  React.useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  React.useEffect(() => {
    const interval = setInterval(() => void refreshRuns(), hasRunning ? 3000 : 60_000);
    return () => clearInterval(interval);
  }, [hasRunning, refreshRuns]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 max-w-[60ch] text-[13px] text-muted-foreground">
            Every sync, classification, briefing, and article fetch - what happened, when, and whether it is
            still running.
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {RANGES.map((entry) => (
            <FilterButton key={entry.id} active={range === entry.id} onClick={() => setRange(entry.id)}>
              {entry.label}
            </FilterButton>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile value={byCategory.length} label={`Runs ${rangeLabel}`} icon={ListChecks} />
        <StatTile value={running} label="Running now" icon={Loader2} />
        <StatTile value={failures} label={`Failures ${rangeLabel}`} icon={AlertTriangle} />
        <StatTile
          value={successRate === null ? "-" : `${successRate}%`}
          label={`Success rate ${rangeLabel}`}
          icon={TrendingUp}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5">
            {CATEGORIES.map((entry) => (
              <FilterButton
                key={entry.id}
                active={category === entry.id}
                onClick={() => setCategory(entry.id)}
              >
                {entry.label}
              </FilterButton>
            ))}
          </div>
          <span className="text-muted-foreground/40">·</span>
          <div className="flex items-center gap-0.5">
            {STATUSES.map((entry) => (
              <FilterButton key={entry.id} active={status === entry.id} onClick={() => setStatus(entry.id)}>
                {entry.label}
              </FilterButton>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Coins className="size-3.5" aria-hidden />
          <span className="tabular-nums">{tokens.toLocaleString("en-US")}</span> tokens {rangeLabel}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No runs here yet"
          description="Sync a source, write a briefing, or fetch an article - every operation is recorded here with its result and token usage."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((run) => {
                const runTokens = run.inputTokens + run.outputTokens;
                const result =
                  run.status === "running" ? "-" : run.status === "failed" ? run.error : run.summary;
                return (
                  <TableRow key={run.id}>
                    <TableCell
                      className="whitespace-nowrap text-muted-foreground"
                      title={new Date(run.startedAt).toLocaleString()}
                      suppressHydrationWarning
                    >
                      {formatRelativeTime(run.startedAt)}
                    </TableCell>
                    <TableCell>
                      <Chip label={CATEGORY_LABELS[run.category]} />
                    </TableCell>
                    <TableCell className="max-w-[24ch] truncate font-medium" title={run.label}>
                      {run.label}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell
                      className="whitespace-normal text-muted-foreground"
                      title={run.error ?? run.summary ?? undefined}
                    >
                      {result ?? "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {runTokens > 0 ? runTokens.toLocaleString("en-US") : "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
