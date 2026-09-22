/**
 * Cover letters: an initial generation, then tone rewrites kept as history.
 */
import { getJob } from "../../db/jobs";
import { getActiveResume, getCoverLetter, saveCoverLetter } from "../../db/job-resumes";
import type { CoverLetterTone, JobCoverLetter } from "../../jobs/types";
import { callLlmStrict, usageOf, type TokenUse } from "../llm";
import { COVER_LETTER_SYSTEM, resumeAndJobPrompt, toneSystem } from "./prompts";
import { errorMessage, withJobRun } from "./run";

export interface CoverLetterResult {
  generated: boolean;
  letter?: JobCoverLetter;
  usage?: TokenUse | null;
  error?: string;
}

export async function generateCoverLetter(jobId: string): Promise<CoverLetterResult> {
  const job = await getJob(jobId);
  if (!job) return { generated: false, error: "Job not found." };
  if (!job.description?.trim()) {
    return {
      generated: false,
      error: "This job has no description yet - add one before generating a cover letter.",
    };
  }

  const label = `${job.title}${job.company ? ` @ ${job.company}` : ""}`;
  return withJobRun(
    label,
    () => "generated",
    async () => {
      const resume = await getActiveResume();
      if (!resume) {
        return { generated: false, error: "No base resume uploaded yet - upload one first." };
      }

      let response;
      try {
        response = await callLlmStrict(
          COVER_LETTER_SYSTEM,
          resumeAndJobPrompt(resume.parsedText, job),
          false
        );
      } catch (error) {
        return { generated: false, error: `Request failed: ${errorMessage(error)}` };
      }

      const usage = usageOf(response);
      const content = response.text?.trim();
      if (!content) {
        return { generated: false, usage, error: "The model returned nothing - cover letter not generated." };
      }

      const letter = await saveCoverLetter({ jobId: job.id, content });
      return { generated: true, letter, usage };
    }
  );
}

/** Rewrites an existing letter in a new tone, keeping the original in history. */
export async function rewriteCoverLetter(
  letterId: string,
  tone: CoverLetterTone
): Promise<CoverLetterResult> {
  const source = await getCoverLetter(letterId);
  if (!source) return { generated: false, error: "Cover letter not found." };
  const job = await getJob(source.jobId);

  const label = `${job ? `${job.title}${job.company ? ` @ ${job.company}` : ""} - ` : ""}${tone} rewrite`;
  return withJobRun(
    label,
    () => "rewritten",
    async () => {
      let response;
      try {
        response = await callLlmStrict(toneSystem(tone), source.content, false);
      } catch (error) {
        return { generated: false, error: `Request failed: ${errorMessage(error)}` };
      }

      const usage = usageOf(response);
      const content = response.text?.trim();
      if (!content) {
        return { generated: false, usage, error: "The model returned nothing - rewrite failed." };
      }

      const letter = await saveCoverLetter({ jobId: source.jobId, content, tone });
      return { generated: true, letter, usage };
    }
  );
}
