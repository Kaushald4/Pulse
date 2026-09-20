/**
 * Filling in job descriptions.
 *
 * The board and ATS providers are list-page only: they return a description
 * solely when the feed happens to include one for free, which almost none do
 * (measured: 3,254 listings across the default boards, one board supplied any).
 * journal had the same gap - its own UI asked you to paste a description in.
 *
 * So descriptions are fetched from the listing's own page instead, through the
 * same extraction engine the reader already uses for articles. That covers
 * board pages and company ATS pages; it is why an engine that renders
 * JavaScript gets further than the plain HTTP one.
 */
import { getConfig, isTauriEnv } from "../config";
import { getJobsMissingDescription, updateJob } from "../db/jobs";
import type { Job, JobScanProgress } from "./types";

/** Long enough for any real posting, short enough to keep prompts sane. */
const MAX_DESCRIPTION_CHARS = 12_000;

/** Default per scan: bounded so a scan stays a scan, not a crawl. */
export const DESCRIPTIONS_PER_SCAN = 5;

interface ExtractedPage {
  text?: string;
  engine?: string;
  title?: string;
}

export interface DescriptionResult {
  description: string | null;
  engine: string | null;
  error?: string;
}

function tidy(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
}

export async function fetchJobDescription(job: Job): Promise<DescriptionResult> {
  const url = job.jobUrl?.trim();
  if (!url) return { description: null, engine: null, error: "This job has no link to open." };
  if (!isTauriEnv()) throw new Error("Fetching a job page needs the desktop app.");

  // Job pages use their own engine, not the article reader's - see AppConfig.
  const config = await getConfig();
  const { invoke } = await import("@tauri-apps/api/core");
  const extracted = await invoke<ExtractedPage>("extract_content", {
    url,
    engine: config.jobsExtraction?.engine ?? "builtin",
  });
  const description = tidy(extracted?.text ?? "");

  if (!description) {
    return { description: null, engine: extracted?.engine ?? null, error: "That page had no readable text." };
  }
  return { description, engine: extracted?.engine ?? null };
}

/**
 * Fetches descriptions for the newest jobs that don't have one. Sequential on
 * purpose: each fetch may launch a browser, and a scan shouldn't fan out.
 */
export async function fillMissingDescriptions(
  limit = DESCRIPTIONS_PER_SCAN,
  onProgress?: (progress: JobScanProgress) => void
): Promise<number> {
  if (!isTauriEnv()) return 0;

  const pending = await getJobsMissingDescription(limit);
  let filled = 0;

  for (const [offset, job] of pending.entries()) {
    onProgress?.({
      stage: "descriptions",
      label: job.title,
      index: offset + 1,
      total: pending.length,
    });
    try {
      const result = await fetchJobDescription(job);
      if (!result.description) continue;
      await updateJob(job.id, { description: result.description });
      filled += 1;
    } catch {
      // A single unreachable listing must not stop the rest.
    }
  }

  return filled;
}
