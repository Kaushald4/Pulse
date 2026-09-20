/**
 * One job scan: every enabled board, plus LinkedIn, then score what arrived
 * without a score.
 *
 * Board listings and LinkedIn listings are stored unscored, so `scoreUnscoredJobs`
 * is what catches them up - bounded per run, so a large backlog just continues
 * on the next scan.
 */
import { scoreUnscoredJobs } from "../ai/jobs/score";
import { scanJobBoards } from "./boards";
import { fillMissingDescriptions } from "./description";
import { fetchLinkedInJobs } from "./linkedin";
import type { JobScanProgress } from "./types";

export interface JobScanReport {
  boards: number;
  found: number;
  described: number;
  scored: number;
  errors: string[];
}

export async function scanJobs(
  onProgress?: (progress: JobScanProgress) => void
): Promise<JobScanReport> {
  const errors: string[] = [];
  let found = 0;
  let boards = 0;

  try {
    const boardResult = await scanJobBoards((progress) =>
      onProgress?.({
        stage: "boards",
        label: progress.entry,
        index: progress.index,
        total: progress.total,
      })
    );
    boards = boardResult.boards;
    found += boardResult.found;
    errors.push(...boardResult.errors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    onProgress?.({ stage: "linkedin", label: "LinkedIn", index: 1, total: 1 });
    const linkedIn = await fetchLinkedInJobs();
    found += linkedIn.found;
    errors.push(...linkedIn.errors);
  } catch (error) {
    errors.push(`LinkedIn: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Descriptions first: a listing that just gained one can be scored in the
  // same pass. Both are bounded, so a scan stays a scan.
  const described = await fillMissingDescriptions(undefined, onProgress);
  const scored = await scoreUnscoredJobs(undefined, onProgress);

  return { boards, found, described, scored: scored.scored, errors };
}
