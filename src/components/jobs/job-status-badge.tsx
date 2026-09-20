"use client";

import { Badge } from "../ui/badge";
import { JOB_STATUS_LABELS, type JobStatus } from "../../lib/jobs/types";
import { cn } from "../../lib/utils";

/**
 * Solid fills, tone carrying the only colour: grey is "not acted on", the
 * accent is "in flight", green and red are outcomes.
 */
const TONE: Record<JobStatus, string> = {
  saved: "bg-secondary text-secondary-foreground",
  applied: "bg-primary text-primary-foreground",
  shortlisted: "bg-success text-success-foreground",
  rejected: "bg-destructive text-destructive-foreground",
};

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <Badge
      className={cn(
        "border-transparent px-2 py-0.5 text-[11px] font-medium shadow-none",
        TONE[status],
        className
      )}
    >
      {JOB_STATUS_LABELS[status]}
    </Badge>
  );
}
