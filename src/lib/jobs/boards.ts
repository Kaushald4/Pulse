/**
 * The board scanner: runs the vendored providers on Node and stores what they
 * return.
 *
 * Rust spawns `jobs/scan.mjs` (the providers need `readdirSync` and
 * cross-origin fetch, neither of which works in the webview) and hands back one
 * result per entry, errors included so a single dead board can't fail a run.
 */
import { isTauriEnv } from "../config";
import { markMissingJobsClosed, upsertJobs } from "../db/jobs";
import { getJobSources } from "../db/job-sources";
import type { JobDraft, JobSource } from "./types";

interface BoardScanResult {
  entry: string;
  provider: string | null;
  jobs: JobDraft[];
  seen: string[];
  error: string | null;
}

export interface BoardScanSummary {
  boards: number;
  found: number;
  errors: string[];
}

/** One board finishing, as it happens. */
export interface BoardProgress {
  entry: string;
  jobs: number;
  error: string | null;
  /** Completed boards so far, and how many are being scanned. */
  index: number;
  total: number;
}

/** Only entries the provider layer can route: an explicit board, or a careers page. */
function isScannable(source: JobSource): boolean {
  return Boolean(source.provider || source.careersUrl || source.api);
}

function toEntry(source: JobSource) {
  return {
    name: source.name,
    provider: source.provider ?? undefined,
    careers_url: source.careersUrl ?? undefined,
    api: source.api ?? undefined,
    max_pages: source.maxPages ?? undefined,
  };
}

async function runScanner(
  entries: Array<ReturnType<typeof toEntry>>
): Promise<BoardScanResult[]> {
  if (!isTauriEnv()) throw new Error("Scanning job boards needs the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BoardScanResult[]>("scan_job_providers", { entries });
}

interface ScannerProgress {
  entry: string;
  provider: string | null;
  jobs: number;
  error: string | null;
}

export async function scanJobBoards(
  onProgress?: (progress: BoardProgress) => void
): Promise<BoardScanSummary> {
  const targets = (await getJobSources()).filter((source) => source.enabled && isScannable(source));
  if (targets.length === 0) return { boards: 0, found: 0, errors: [] };

  // The scanner reports each board as it finishes; turn that into "n of total".
  let done = 0;
  let unlisten: (() => void) | undefined;
  if (onProgress && isTauriEnv()) {
    const { listen } = await import("@tauri-apps/api/event");
    unlisten = await listen<ScannerProgress>("job-scan-progress", (event) => {
      done += 1;
      onProgress({
        entry: event.payload.entry,
        jobs: event.payload.jobs,
        error: event.payload.error,
        index: done,
        total: targets.length,
      });
    });
  }

  try {
    const results = await runScanner(targets.map(toEntry));
    const errors: string[] = [];
    let found = 0;

    for (const result of results) {
      if (result.error) {
        errors.push(`${result.entry}: ${result.error}`);
        continue;
      }

      found += await upsertJobs(result.jobs);

      // Only diff-close on a genuine, non-empty result: an empty or failed fetch
      // must never read as "every job from this source just closed".
      if (result.provider && result.seen.length > 0) {
        await markMissingJobsClosed(result.provider, result.seen);
      }
    }

    return { boards: targets.length, found, errors };
  } finally {
    unlisten?.();
  }
}
