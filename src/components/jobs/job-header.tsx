"use client";

import { ArrowLeft, Building2, ExternalLink, MapPin } from "lucide-react";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useJobs } from "../../store/jobs";
import { openExternal } from "../../lib/config";
import { JOB_STATUS_LABELS, JOB_STATUS_ORDER, type JobStatus } from "../../lib/jobs/types";

export function JobHeader() {
  const job = useJobs((state) => state.job);
  const closeJob = useJobs((state) => state.closeJob);
  const setStatus = useJobs((state) => state.setStatus);

  if (!job) return null;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={closeJob}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All jobs
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{job.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            {job.company && (
              <span className="flex items-center gap-1.5">
                <Building2 className="size-3.5" aria-hidden />
                {job.company}
              </span>
            )}
            {(job.location || job.workplaceType) && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden />
                {[job.location, job.workplaceType].filter(Boolean).join(" · ")}
              </span>
            )}
            {job.jobUrl && (
              <button
                type="button"
                onClick={() => void openExternal(job.jobUrl as string)}
                className="flex items-center gap-1.5 transition-colors hover:text-foreground"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Original listing
              </button>
            )}
          </div>
        </div>

        <Select value={job.status} onValueChange={(value) => void setStatus(value as JobStatus)}>
          <SelectTrigger className="h-8 w-40 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOB_STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status}>
                {JOB_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
