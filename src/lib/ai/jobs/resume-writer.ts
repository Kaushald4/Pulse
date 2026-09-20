/**
 * Tailored resume generation and per-selection rewrites.
 *
 * The model returns plain text in a fixed structural convention; the `.docx`
 * is rendered from that text at download time, so nothing binary is stored.
 */
import { getJob } from "../../db/jobs";
import {
  getActiveResume,
  getGeneratedResume,
  saveGeneratedResume,
} from "../../db/job-resumes";
import type { GeneratedResume } from "../../jobs/types";
import { callLlmStrict, usageOf, type TokenUse } from "../llm";
import {
  buildResumeFileName,
  RESUME_SYSTEM,
  resumeAndJobPrompt,
  selectionPrompt,
  SELECTION_REWRITE_SYSTEM,
} from "./prompts";
import { errorMessage, withJobRun } from "./run";

export interface GenerateResumeResult {
  generated: boolean;
  draft?: GeneratedResume;
  usage?: TokenUse | null;
  error?: string;
}

export async function generateTailoredResume(jobId: string): Promise<GenerateResumeResult> {
  const job = await getJob(jobId);
  if (!job) return { generated: false, error: "Job not found." };
  if (!job.description?.trim()) {
    return { generated: false, error: "This job has no description yet - add one before generating a resume." };
  }

  const label = `${job.title}${job.company ? ` @ ${job.company}` : ""}`;
  return withJobRun(label, (result) => result.draft?.fileName ?? "generated", async () => {
    const resume = await getActiveResume();
    if (!resume) {
      return { generated: false, error: "No base resume uploaded yet - upload one first." };
    }

    let response;
    try {
      response = await callLlmStrict(
        RESUME_SYSTEM,
        resumeAndJobPrompt(resume.parsedText, job, "BASE RESUME"),
        false
      );
    } catch (error) {
      return { generated: false, error: `Request failed: ${errorMessage(error)}` };
    }

    const usage = usageOf(response);
    const content = response.text?.trim();
    if (!content) {
      return { generated: false, usage, error: "The model returned nothing - resume not generated." };
    }

    const draft = await saveGeneratedResume({
      jobId: job.id,
      baseResumeId: resume.id,
      content,
      fileName: buildResumeFileName(job.title, job.company),
    });
    return { generated: true, draft, usage };
  });
}

export interface RewriteSelectionResult {
  rewritten: boolean;
  text?: string;
  usage?: TokenUse | null;
  error?: string;
}

/**
 * Rewrites just the highlighted span. Stateless by design: the editor splices
 * the result into its own draft and the user's save commits it.
 */
export async function rewriteResumeSelection(
  draftId: string,
  selectedText: string
): Promise<RewriteSelectionResult> {
  const selection = selectedText.trim();
  if (!selection) return { rewritten: false, error: "No text is selected." };

  const draft = await getGeneratedResume(draftId);
  if (!draft) return { rewritten: false, error: "Generated resume not found." };
  const job = await getJob(draft.jobId);
  if (!job) return { rewritten: false, error: "Job not found." };

  return withJobRun(
    `${job.title}${job.company ? ` @ ${job.company}` : ""} - selection rewrite`,
    () => "selection rewritten",
    async () => {
      let response;
      try {
        response = await callLlmStrict(
          SELECTION_REWRITE_SYSTEM,
          selectionPrompt(draft.content, job, selection),
          false
        );
      } catch (error) {
        return { rewritten: false, error: `Request failed: ${errorMessage(error)}` };
      }

      const usage = usageOf(response);
      const text = response.text?.trim();
      if (!text) {
        return { rewritten: false, usage, error: "The model returned nothing - selection not rewritten." };
      }
      return { rewritten: true, text, usage };
    }
  );
}
