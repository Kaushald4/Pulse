"use client";

import React from "react";
import { BriefcaseBusiness, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { EmptyState } from "../empty-state";
import { BaseResumePanel } from "./base-resume-panel";
import { JobCard } from "./job-card";
import { JobsToolbar } from "./jobs-toolbar";
import { NewJobDialog } from "./new-job-dialog";
import { ScanProgress } from "./scan-progress";
import { useJobs } from "../../store/jobs";
import { cn } from "../../lib/utils";

export function JobsView() {
  const ready = useJobs((state) => state.ready);
  const jobs = useJobs((state) => state.jobs);
  const filter = useJobs((state) => state.filter);
  const busy = useJobs((state) => state.busy);
  const init = useJobs((state) => state.init);
  const setFilter = useJobs((state) => state.setFilter);
  const scan = useJobs((state) => state.scan);
  const openJob = useJobs((state) => state.openJob);

  React.useEffect(() => {
    void init();
  }, [init]);

  const scanning = busy === "scan";
  const filtered = filter.status !== "all" || filter.search.trim().length > 0;

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Work Jobs</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Listings from every source, scored against your base resume - kept apart from your feed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NewJobDialog />
          <Button size="sm" onClick={() => void scan()} disabled={scanning} className="gap-1.5">
            <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} />
            {scanning ? "Scanning…" : "Scan"}
          </Button>
        </div>
      </div>

      <BaseResumePanel />
      <ScanProgress />
      <JobsToolbar filter={filter} onChange={(patch) => void setFilter(patch)} />

      {!ready ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title={filtered ? "No jobs match these filters" : "No jobs yet"}
          description={
            filtered
              ? "Try another status, or clear the search."
              : "Hit Scan to pull from the job boards, or add a listing you found yourself."
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onOpen={() => void openJob(job.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
