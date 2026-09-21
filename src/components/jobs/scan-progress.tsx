"use client";

import { Loader2, Square } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useJobs } from "../../store/jobs";
import type { JobScanProgress } from "../../lib/jobs/types";

const STAGE_LABELS: Record<JobScanProgress["stage"], string> = {
  boards: "Scanning boards",
  linkedin: "Scanning LinkedIn",
  descriptions: "Fetching descriptions",
  scoring: "Scoring",
};

/**
 * Live progress, and the way out of it.
 *
 * The board scanner announces each entry as it starts and as it finishes, so
 * this names the board being waited on rather than the last one it completed,
 * and the count only moves when a board is actually done. A scan is a child
 * process doing dozens of network calls, so it can be stopped: only a scan can,
 * since scoring is a model call per job with its own button spinner.
 */
export function ScanProgress() {
  const progress = useJobs((state) => state.scanProgress);
  const busy = useJobs((state) => state.busy);
  const stopping = useJobs((state) => state.stopping);
  const cancelScan = useJobs((state) => state.cancelScan);

  const scanning = busy === "scan";
  const running = scanning || busy === "score-all";
  if (!running) return null;
  // A scan shows from the moment it starts, before the first board reports: the
  // wait for the scanner process is exactly when a stop is most likely wanted.
  // Scoring has nothing to stop, so it waits for its first result.
  if (!progress && !scanning) return null;

  const percent = progress && progress.total > 0 ? Math.round((progress.index / progress.total) * 100) : 0;

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-2 text-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">
            {progress ? STAGE_LABELS[progress.stage] : "Starting the scanner"}
          </span>
          {progress && <span className="truncate font-medium">{progress.label}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="tabular-nums text-muted-foreground">
            {progress ? `${progress.index} / ${progress.total}` : ""}
          </span>
          {scanning && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void cancelScan()}
              disabled={stopping}
              className="h-7 gap-1.5 px-2 text-[11px]"
            >
              <Square className="size-3 fill-current" />
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          )}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </Card>
  );
}
