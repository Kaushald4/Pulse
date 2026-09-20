/**
 * Fit scoring: how well the active base resume matches one job description.
 */
import { getJob, getUnscoredJobs, saveJobScore } from "../../db/jobs";
import { getActiveResume } from "../../db/job-resumes";
import type { JobScanProgress } from "../../jobs/types";
import { parseJsonLoose } from "../../utils";
import { callLlmStrict, usageOf, type TokenUse } from "../llm";
import { resumeAndJobPrompt, SCORE_SYSTEM } from "./prompts";
import { errorMessage, withJobRun } from "./run";

export interface ScoreJobResult {
  scored: boolean;
  score?: number;
  reasoning?: string;
  usage?: TokenUse | null;
  error?: string;
}

interface ScorePayload {
  score?: number;
  reasoning?: string;
}

const BATCH_LIMIT = 25;

function jobLabel(title: string, company: string | null): string {
  return `${title}${company ? ` @ ${company}` : ""}`;
}

/** Scores one job against the active base resume. */
export async function scoreJobRelevance(jobId: string): Promise<ScoreJobResult> {
  const job = await getJob(jobId);
  if (!job) return { scored: false, error: "Job not found." };
  if (!job.description?.trim()) {
    return { scored: false, error: "This job has no description yet - add one before scoring." };
  }

  return withJobRun(jobLabel(job.title, job.company), (result) => `score ${result.score}/100`, async () => {
    const resume = await getActiveResume();
    if (!resume) {
      return { scored: false, error: "No base resume uploaded yet - upload one first." };
    }

    let response;
    try {
      response = await callLlmStrict(SCORE_SYSTEM, resumeAndJobPrompt(resume.parsedText, job), true);
    } catch (error) {
      return { scored: false, error: `Request failed: ${errorMessage(error)}` };
    }

    const usage = usageOf(response);
    const parsed = parseJsonLoose<ScorePayload>(response.text);
    const score =
      typeof parsed?.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null;
    const reasoning = typeof parsed?.reasoning === "string" ? parsed.reasoning.trim() : "";

    if (score === null || !reasoning) {
      return { scored: false, usage, error: "The model's score could not be read." };
    }

    await saveJobScore(job.id, score, reasoning);
    return { scored: true, score, reasoning, usage };
  });
}

export interface ScoreUnscoredResult {
  processed: number;
  scored: number;
}

/**
 * Scores the backlog of listings that arrived without a score.
 *
 * Portal-sourced jobs are stored unscored, so this is what catches them up.
 * With no base resume there is nothing to score against, so it does nothing
 * rather than failing a scan.
 */
export async function scoreUnscoredJobs(
  limit = BATCH_LIMIT,
  onProgress?: (progress: JobScanProgress) => void
): Promise<ScoreUnscoredResult> {
  const resume = await getActiveResume();
  if (!resume) return { processed: 0, scored: 0 };

  const pending = await getUnscoredJobs(limit);
  let scored = 0;

  for (const [offset, job] of pending.entries()) {
    onProgress?.({
      stage: "scoring",
      label: `${job.title}${job.company ? ` @ ${job.company}` : ""}`,
      index: offset + 1,
      total: pending.length,
    });
    const result = await scoreJobRelevance(job.id);
    if (result.scored) scored += 1;
  }

  return { processed: pending.length, scored };
}
