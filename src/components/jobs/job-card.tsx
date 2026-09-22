"use client";

import { Building2, MapPin } from "lucide-react";
import { Card } from "../ui/card";
import { JobStatusBadge } from "./job-status-badge";
import { JobRelevanceScore } from "./job-relevance-score";
import type { Job } from "../../lib/jobs/types";
import { formatRelativeTime } from "../../lib/utils";

export function JobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  return (
    <Card
      className="flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:bg-accent/40"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-[14px] font-medium leading-5 text-foreground">{job.title}</h3>
        <JobStatusBadge status={job.status} className="shrink-0" />
      </div>

      <div className="space-y-1 text-[12px] text-muted-foreground">
        {job.company && (
          <div className="flex items-center gap-1.5">
            <Building2 className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{job.company}</span>
          </div>
        )}
        {(job.location || job.workplaceType) && (
          <div className="flex items-center gap-1.5">
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{[job.location, job.workplaceType].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <JobRelevanceScore score={job.relevanceScore} reasoning={job.relevanceReasoning} />
        <span className="shrink-0 text-[11px] text-muted-foreground" suppressHydrationWarning>
          {formatRelativeTime(job.postedAt ?? job.createdAt)}
        </span>
      </div>
    </Card>
  );
}
