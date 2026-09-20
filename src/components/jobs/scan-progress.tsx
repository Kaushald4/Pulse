"use client";

import { Loader2 } from "lucide-react";
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
 * Live scan progress.
 *
 * The board scanner reports each entry as it finishes (via a Tauri event), and
 * the description and scoring passes report per job, so this names what is
 * actually happening rather than spinning anonymously.
 */
export function ScanProgress() {
  const progress = useJobs((state) => state.scanProgress);
  const busy = useJobs((state) => state.busy);

  if (busy !== "scan" || !progress) return null;

  const percent = progress.total > 0 ? Math.round((progress.index / progress.total) * 100) : 0;

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-2 text-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">{STAGE_LABELS[progress.stage]}</span>
          <span className="truncate font-medium">{progress.label}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {progress.index} / {progress.total}
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
