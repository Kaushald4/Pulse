/**
 * Adding a job you found yourself.
 *
 * Scored immediately, like journal does: a manual job always has a description,
 * so there is nothing to wait for.
 */
import { insertManualJob } from "../db/jobs";
import { scoreJobRelevance } from "../ai/jobs/score";
import type { Job } from "./types";

export interface ManualJobInput {
  title: string;
  description: string;
  company?: string;
  location?: string;
  jobUrl?: string;
}

export interface ManualJobResult {
  job: Job;
  scored: boolean;
  error?: string;
}

export async function addManualJob(input: ManualJobInput): Promise<ManualJobResult> {
  const job = await insertManualJob(input);

  try {
    const score = await scoreJobRelevance(job.id);
    return { job, scored: score.scored, error: score.error };
  } catch (error) {
    return {
      job,
      scored: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
