/**
 * Fit scoring: how well the active base resume matches one job description.
 */
import { countUnscoredJobs, getJob, getUnscoredJobs, saveJobScore } from "../../db/jobs";
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

  return withJobRun(
    jobLabel(job.title, job.company),
    (result) => `score ${result.score}/100`,
    async () => {
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
    }
  );
}

export interface ScoreBacklogResult {
  scored: number;
  /** Jobs the model ran on but whose score could not be read. They stay unscored. */
  failed: number;
}

/**
 * Scores every unscored job that has a description, in batches.
 *
 * Driven by the user from the jobs screen — a scan never calls this, so a
 * routine board refresh cannot spend model calls on its own.
 */
export async function scoreUnscoredBacklog(
  onProgress?: (progress: JobScanProgress) => void
): Promise<ScoreBacklogResult> {
  const resume = await getActiveResume();
  if (!resume) return { scored: 0, failed: 0 };

  // Counted once so progress reads `n / total` instead of restarting each batch.
  const total = await countUnscoredJobs();

  // A job whose score comes back unreadable stays unscored, so it would be
  // selected again forever. Track what has been attempted and stop once a batch
  // brings nothing new.
  const attempted = new Set<string>();
  let scored = 0;
  let failed = 0;

  for (;;) {
    const batch = (await getUnscoredJobs(BATCH_LIMIT)).filter((job) => !attempted.has(job.id));
    if (batch.length === 0) break;

    for (const job of batch) {
      attempted.add(job.id);
      onProgress?.({
        stage: "scoring",
        label: jobLabel(job.title, job.company),
        index: attempted.size,
        total: Math.max(total, attempted.size),
      });

      const result = await scoreJobRelevance(job.id);
      if (result.scored) scored += 1;
      else failed += 1;
    }

    if (batch.length < BATCH_LIMIT) break;
  }

  return { scored, failed };
}
