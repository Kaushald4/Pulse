/**
 * Jobs domain types.
 *
 * Kept out of `lib/types.ts` on purpose: jobs are a self-contained feature and
 * nothing here is ever read by the feed.
 */

export type JobStatus = "saved" | "applied" | "shortlisted" | "rejected";

/** Display order, matching journal's tabs. */
export const JOB_STATUS_ORDER: JobStatus[] = ["saved", "applied", "shortlisted", "rejected"];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
};

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUS_ORDER as string[]).includes(value);
}

/** A stored job posting. */
export interface Job {
  id: string;
  source: string;
  externalId: string | null;
  jobUrl: string | null;
  title: string;
  company: string | null;
  location: string | null;
  workplaceType: string | null;
  description: string | null;
  status: JobStatus;
  relevanceScore: number | null;
  relevanceReasoning: string | null;
  postedAt: string | null;
  createdAt: string;
  statusUpdatedAt: string | null;
  closedAt: string | null;
}

/** A job as a source hands it over, before it is stored. */
export interface JobDraft {
  source: string;
  externalId: string | null;
  jobUrl: string | null;
  title: string;
  company?: string | null;
  location?: string | null;
  workplaceType?: string | null;
  description?: string | null;
  postedAt?: string | null;
}

/** The user's base resume - only one is active at a time. */
export interface BaseResume {
  id: string;
  fileName: string;
  mimeType: string;
  parsedText: string;
  isActive: boolean;
  uploadedAt: string;
}

/** A resume tailored to one job. History, never overwritten. */
export interface GeneratedResume {
  id: string;
  jobId: string;
  baseResumeId: string | null;
  content: string;
  fileName: string;
  generatedAt: string;
}

/** A cover letter for one job. History; `tone` is set on rewrites. */
export interface JobCoverLetter {
  id: string;
  jobId: string;
  content: string;
  tone: string | null;
  generatedAt: string;
}

/** One configured job source: a board, or a tracked company's careers page. */
export interface JobSource {
  id: string;
  name: string;
  provider: string | null;
  careersUrl: string | null;
  api: string | null;
  maxPages: number | null;
  enabled: boolean;
  createdAt: string;
}

export type JobSort = "postedAt" | "createdAt" | "relevanceScore";

export interface JobFilter {
  status: JobStatus | "all";
  sort: JobSort;
  search: string;
}

export const DEFAULT_JOB_FILTER: JobFilter = { status: "all", sort: "postedAt", search: "" };

export interface JobDetail {
  job: Job;
  resumes: GeneratedResume[];
  coverLetters: JobCoverLetter[];
}

export type CoverLetterTone = "standard" | "professional" | "academic" | "casual";

export const COVER_LETTER_TONES: CoverLetterTone[] = ["standard", "professional", "academic", "casual"];

/** Live progress for a scan, so the UI can name what it is working on. */
export interface JobScanProgress {
  stage: "boards" | "linkedin" | "descriptions" | "scoring";
  label: string;
  index: number;
  total: number;
}
