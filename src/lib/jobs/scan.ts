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
  /** True when the user stopped it, so the caller reports a stop and not a failure. */
  stopped: boolean;
}

/**
 * Set while a stop is in flight.
 *
 * Kept here rather than threaded through every stage: the stages run in sequence
 * and each one is free to be slow, so the cheapest correct thing is to check
 * between them and not start the next one. Without it a stopped scan would stop
 * only the boards and then carry on into LinkedIn and the description fetches.
 */
let stopped = false;

/** Called by the store just before it asks Rust to kill the scanner. */
export function markScanStopped(): void {
  stopped = true;
}

export async function scanJobs(onProgress?: (progress: JobScanProgress) => void): Promise<JobScanReport> {
  const errors: string[] = [];
  let found = 0;
  let boards = 0;
  stopped = false;

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
    // A stopped scan fails inside the scanner, which is expected and not worth
    // reporting as a problem.
    if (stopped) return { boards: 0, found: 0, described: 0, errors: [], stopped: true };
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (stopped) return { boards, found, described: 0, errors, stopped: true };

  try {
    onProgress?.({ stage: "linkedin", label: "LinkedIn", index: 1, total: 1 });
    const linkedIn = await fetchLinkedInJobs();
    found += linkedIn.found;
    errors.push(...linkedIn.errors);
  } catch (error) {
    errors.push(`LinkedIn: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (stopped) return { boards, found, described: 0, errors, stopped: true };

  // Descriptions are page fetches, not model calls, so they stay part of a scan.
  // Bounded, so a scan stays a scan.
  const described = await fillMissingDescriptions(undefined, onProgress);

  return { boards, found, described, errors, stopped: false };
}
