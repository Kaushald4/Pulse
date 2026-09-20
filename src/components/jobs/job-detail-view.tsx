"use client";

import { JobCoverLetterCard } from "./job-cover-letter-card";
import { JobDescriptionCard } from "./job-description-card";
import { JobHeader } from "./job-header";
import { JobRelevanceCard } from "./job-relevance-card";
import { JobResumeCard } from "./job-resume-card";
import { useJobs } from "../../store/jobs";

/**
 * The job's own page - reached from the list and left with the header's back
 * link. The app is a static export, so this is a view rather than a `/jobs/[id]`
 * route.
 */
export function JobDetailView() {
  const job = useJobs((state) => state.job);
  if (!job) return null;

  return (
    <div className="space-y-5 pb-12">
      <JobHeader />
      <JobRelevanceCard />
      <JobDescriptionCard />
      <JobResumeCard />
      <JobCoverLetterCard />
    </div>
  );
}
