/**
 * The job boards Pulse tracks out of the box.
 *
 * Mirrors `sync/src/job-providers-config.ts`: these are the board-wide feeds
 * that need no per-company configuration. Every other provider in
 * `jobs/providers/` is reached by adding a company entry with a `careers_url`.
 */
import type { JobSource } from "./types";

interface BoardDefault {
  id: string;
  name: string;
  provider: string;
  enabled?: boolean;
}

export const DEFAULT_JOB_BOARDS: BoardDefault[] = [
  { id: "remoteok", name: "RemoteOK", provider: "remoteok" },
  { id: "weworkremotely", name: "We Work Remotely", provider: "weworkremotely" },
  { id: "himalayas", name: "Himalayas", provider: "himalayas" },
  { id: "remotive", name: "Remotive", provider: "remotive" },
  { id: "nodesk", name: "NoDesk", provider: "nodesk" },
  { id: "jobspresso", name: "Jobspresso", provider: "jobspresso" },
  { id: "workingnomads", name: "Working Nomads", provider: "workingnomads" },
  { id: "jobicy", name: "Jobicy", provider: "jobicy" },
  { id: "larajobs", name: "LaraJobs", provider: "larajobs" },
  { id: "4dayweek", name: "4 Day Week", provider: "4dayweek" },
  { id: "arbeitnow", name: "Arbeitnow", provider: "arbeitnow" },
  { id: "cryptocurrencyjobs", name: "CryptocurrencyJobs", provider: "cryptocurrencyjobs" },
  { id: "getonbrd", name: "Get on Board", provider: "getonbrd" },
  { id: "landingjobs", name: "Landing.jobs", provider: "landingjobs" },
  { id: "themuse", name: "The Muse", provider: "themuse" },
  { id: "flowxtra", name: "Flowxtra", provider: "flowxtra" },
  { id: "hackernews", name: "Hacker News Who's Hiring", provider: "hackernews" },
  { id: "agentic-jobs", name: "Agentic Jobs", provider: "agentic-jobs" },
  // Confirmed dead as zero-config feeds - kept so the choice is visible rather
  // than silently absent.
  { id: "echojobs", name: "EchoJobs", provider: "echojobs", enabled: false },
  { id: "thehub", name: "The Hub", provider: "thehub", enabled: false },
];

export function defaultJobSources(now = new Date().toISOString()): JobSource[] {
  return DEFAULT_JOB_BOARDS.map((board) => ({
    id: board.id,
    name: board.name,
    provider: board.provider,
    careersUrl: null,
    api: null,
    maxPages: null,
    enabled: board.enabled !== false,
    createdAt: now,
  }));
}
