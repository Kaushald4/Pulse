/**
 * One job scan: every enabled board, plus LinkedIn, then descriptions for the
 * newest listings that arrived without one.
 *
 * A scan only collects. Board and LinkedIn listings are stored unscored, and
 * scoring is a separate, deliberate action from the jobs screen
 * (`scoreUnscoredBacklog`), so a routine refresh never spends model calls.
 */
import { scanJobBoards } from "./boards";
import { fillMissingDescriptions } from "./description";
import { fetchLinkedInJobs } from "./linkedin";
import type { JobScanProgress } from "./types";

export interface JobScanReport {
  boards: number;
  found: number;
  described: number;
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

  // Descriptions are page fetches, not model calls, so they stay part of a scan.
  // Bounded, so a scan stays a scan.
  const described = await fillMissingDescriptions(undefined, onProgress);

  return { boards, found, described, errors };
}
