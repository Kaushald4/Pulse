/**
 * One-time move of the browser storage into SQLite.
 *
 * The app falls back to localStorage whenever SQLite is unreachable, and a build
 * missing the `sql:allow-execute` capability is exactly that case, so every read
 * and write had been taking the browser branch. Once the capability is granted,
 * SQLite opens empty, and without this the library, the job hunt and the
 * configured sources would all look wiped the first time the app is launched
 * after upgrading.
 *
 * Each table is written through the module that owns it, so there is still one
 * write path per table and no second copy of the SQL. Repeating it is harmless:
 * every writer upserts, and the marker that stops it running again is written
 * only after everything else has succeeded.
 */
import type {
  DailyBriefing,
  Project,
  PulseItem,
  PulseSchedule,
  ResourcePreview,
  SignalPreference,
  SourceConnection,
  Watchlist,
} from "../types";
import type { Job, JobSource } from "../jobs/types";
import { saveBriefing } from "./briefings";
import { readLocal } from "./client";
import { restoreJobs } from "./jobs";
import { saveJobSource } from "./job-sources";
import { LS_JOBS, LS_JOB_COVER_LETTERS, LS_JOB_DRAFTS, LS_JOB_RESUMES, LS_JOB_SOURCES } from "./jobs-common";
import { applyLinkPreviews } from "./link-previews";
import {
  LS_BRIEFINGS,
  LS_ITEMS,
  LS_LINK_PREVIEWS,
  LS_PREFERENCES,
  LS_PROJECTS,
  LS_RUNS,
  LS_SCHEDULE,
  LS_SOURCES,
  LS_WATCHLISTS,
} from "./local-keys";
import { upsertItems } from "./items";
import { saveProject, saveSchedule, saveSignalPreferences, saveWatchlist } from "./personal";
import { restoreRuns, type RunRecord } from "./runs";
import { saveSources } from "./sources";

/** Set in app_meta once the import has completed, so it never runs twice. */
const MARKER = "browser_storage_imported";

/** How many records moved, per store, for the log line. */
export type ImportReport = Record<string, number>;

export async function importBrowserStorage(db: any): Promise<ImportReport | null> {
  // No SQLite means the browser store *is* the store, so there is nothing to move.
  if (!db) return null;

  const marker = (await db.select(`SELECT value FROM app_meta WHERE key = $1;`, [MARKER])) as unknown[];
  if (marker.length > 0) return null;

  const report: ImportReport = {};

  const items = readLocal<PulseItem[]>(LS_ITEMS, []);
  if (items.length > 0) {
    await upsertItems(items);
    report.items = items.length;
  }

  const sources = readLocal<SourceConnection[]>(LS_SOURCES, []);
  if (sources.length > 0) {
    await saveSources(sources);
    report.sources = sources.length;
  }

  const jobs = readLocal<Job[]>(LS_JOBS, []);
  if (jobs.length > 0) {
    report.jobs = await restoreJobs(jobs);
  }

  const jobSources = readLocal<JobSource[]>(LS_JOB_SOURCES, []);
  if (jobSources.length > 0) {
    for (const source of jobSources) await saveJobSource(source);
    report.jobSources = jobSources.length;
  }

  const runs = readLocal<RunRecord[]>(LS_RUNS, []);
  if (runs.length > 0) {
    report.runs = await restoreRuns(runs);
  }

  // Stored as a map of url to preview, which is the shape the writer takes once
  // the url is put back on the record.
  const previews = readLocal<Record<string, ResourcePreview>>(LS_LINK_PREVIEWS, {});
  const previewUpdates = Object.entries(previews).map(([url, preview]) => ({
    url,
    ...preview,
    siteName: null,
  }));
  if (previewUpdates.length > 0) {
    await applyLinkPreviews(previewUpdates);
    report.linkPreviews = previewUpdates.length;
  }

  const briefings = Object.values(readLocal<Record<string, DailyBriefing>>(LS_BRIEFINGS, {}));
  for (const briefing of briefings) await saveBriefing(briefing);
  if (briefings.length > 0) report.briefings = briefings.length;

  const preferences = readLocal<SignalPreference[]>(LS_PREFERENCES, []);
  if (preferences.length > 0) {
    await saveSignalPreferences(preferences);
    report.preferences = preferences.length;
  }

  const watchlists = readLocal<Watchlist[]>(LS_WATCHLISTS, []);
  for (const watchlist of watchlists) await saveWatchlist(watchlist);
  if (watchlists.length > 0) report.watchlists = watchlists.length;

  const projects = readLocal<Project[]>(LS_PROJECTS, []);
  for (const project of projects) await saveProject(project);
  if (projects.length > 0) report.projects = projects.length;

  const schedule = readLocal<PulseSchedule | null>(LS_SCHEDULE, null);
  if (schedule) {
    await saveSchedule(schedule);
    report.schedule = 1;
  }

  // The tailored-resume family is deliberately not replayed. Its only writers mint
  // a fresh id and stamp the current time, so importing a draft through them would
  // leave it pointing at a resume that does not exist. Rewriting those wants its
  // own path, not a lossy one, so say so rather than dropping them in silence.
  const stranded = [LS_JOB_RESUMES, LS_JOB_DRAFTS, LS_JOB_COVER_LETTERS].filter(
    (key) => readLocal<unknown[]>(key, []).length > 0
  );
  if (stranded.length > 0) {
    console.warn("[Pulse] Browser storage not imported, rewriting it would be lossy:", stranded.join(", "));
  }

  await db.execute(
    `INSERT INTO app_meta (key, value) VALUES ($1,$2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [MARKER, new Date().toISOString()]
  );

  console.info("[Pulse] Imported browser storage into SQLite:", report);
  return report;
}
