/**
 * Shared job storage helpers: local-storage keys and row mappers.
 *
 * Every job module reads rows through here, so a column rename only has to be
 * handled in one place.
 */
import type {
  BaseResume,
  GeneratedResume,
  Job,
  JobCoverLetter,
  JobSource,
} from "../jobs/types";

export const LS_JOBS = "pulse_jobs_v1";
export const LS_JOB_RESUMES = "pulse_job_resumes_v1";
export const LS_JOB_DRAFTS = "pulse_job_drafts_v1";
export const LS_JOB_COVER_LETTERS = "pulse_job_cover_letters_v1";
export const LS_JOB_SOURCES = "pulse_job_sources_v1";

export function newJobId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function blank(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function rowToJob(row: any): Job {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id ?? null,
    jobUrl: row.job_url ?? null,
    title: row.title ?? "",
    company: row.company ?? null,
    location: row.location ?? null,
    workplaceType: row.workplace_type ?? null,
    description: row.description ?? null,
    status: row.status ?? "saved",
    relevanceScore: row.relevance_score ?? null,
    relevanceReasoning: row.relevance_reasoning ?? null,
    postedAt: row.posted_at ?? null,
    createdAt: row.created_at ?? new Date().toISOString(),
    statusUpdatedAt: row.status_updated_at ?? null,
    closedAt: row.closed_at ?? null,
  };
}

export function rowToBaseResume(row: any): BaseResume {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    parsedText: row.parsed_text ?? "",
    isActive: Boolean(row.is_active),
    uploadedAt: row.uploaded_at,
  };
}

export function rowToGeneratedResume(row: any): GeneratedResume {
  return {
    id: row.id,
    jobId: row.job_id,
    baseResumeId: row.base_resume_id ?? null,
    content: row.content ?? "",
    fileName: row.file_name,
    generatedAt: row.generated_at,
  };
}

export function rowToCoverLetter(row: any): JobCoverLetter {
  return {
    id: row.id,
    jobId: row.job_id,
    content: row.content ?? "",
    tone: row.tone ?? null,
    generatedAt: row.generated_at,
  };
}

export function rowToJobSource(row: any): JobSource {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider ?? null,
    careersUrl: row.careers_url ?? null,
    api: row.api ?? null,
    maxPages: row.max_pages ?? null,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
  };
}
