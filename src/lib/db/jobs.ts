/**
 * Job posting reads and writes.
 *
 * The upsert rule is deliberate and matches journal: re-seeing a listing may
 * refresh its descriptive fields, but it must never clobber the user's status,
 * score or notes about it.
 */
import { JOB_STATUS_ORDER, isJobStatus } from "../jobs/types";
import type { Job, JobDraft, JobFilter } from "../jobs/types";
import { getDatabase, readLocal, writeLocal } from "./client";
import { blank, LS_JOBS, newJobId, rowToJob } from "./jobs-common";

function matchesSearch(job: Job, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [job.title, job.company, job.location, job.description]
    .filter(Boolean)
    .some((field) => (field as string).toLowerCase().includes(needle));
}

/** A closed listing you never acted on is noise; one you applied to is history. */
function isVisible(job: Job): boolean {
  if (!job.closedAt) return true;
  return job.status !== "saved";
}

function sortJobs(jobs: Job[], sort: JobFilter["sort"]): Job[] {
  const copy = [...jobs];
  const time = (value: string | null) => (value ? new Date(value).getTime() || 0 : 0);
  if (sort === "relevanceScore") {
    copy.sort((a, b) => (b.relevanceScore ?? -1) - (a.relevanceScore ?? -1));
  } else if (sort === "createdAt") {
    copy.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  } else {
    copy.sort((a, b) => time(b.postedAt) - time(a.postedAt));
  }
  return copy;
}

export async function getJobs(filter: JobFilter, limit = 200): Promise<Job[]> {
  const db = await getDatabase();

  if (db) {
    const conditions: string[] = [`(closed_at IS NULL OR status IN ('applied','shortlisted','rejected'))`];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      conditions.push(clause.replace("?", `$${params.length}`));
    };

    if (filter.status !== "all") add("status = ?", filter.status);
    if (filter.search.trim()) {
      params.push(`%${filter.search.trim()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(title LIKE ${p} OR company LIKE ${p} OR location LIKE ${p} OR description LIKE ${p})`
      );
    }

    const orderBy = {
      postedAt: "posted_at DESC",
      createdAt: "created_at DESC",
      relevanceScore: "relevance_score IS NULL, relevance_score DESC",
    }[filter.sort];

    params.push(limit);
    const rows = (await db.select(
      `SELECT * FROM jobs WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy} LIMIT $${params.length};`,
      params
    )) as any[];
    return rows.map(rowToJob);
  }

  const stored = readLocal<Job[]>(LS_JOBS, []);
  return sortJobs(
    stored
      .filter(isVisible)
      .filter((job) => filter.status === "all" || job.status === filter.status)
      .filter((job) => matchesSearch(job, filter.search)),
    filter.sort
  ).slice(0, limit);
}

export async function getJob(id: string): Promise<Job | null> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM jobs WHERE id = $1;`, [id])) as any[];
    return rows[0] ? rowToJob(rows[0]) : null;
  }
  return readLocal<Job[]>(LS_JOBS, []).find((job) => job.id === id) ?? null;
}

/** Visible jobs per status, plus the scoring backlog — powers the header badge and tabs. */
export interface JobCounts {
  total: number;
  saved: number;
  applied: number;
  shortlisted: number;
  rejected: number;
  /** Jobs with a description and no score yet: exactly what the Score button acts on. */
  unscored: number;
}

export function emptyJobCounts(): JobCounts {
  return { total: 0, saved: 0, applied: 0, shortlisted: 0, rejected: 0, unscored: 0 };
}

/**
 * Counts over visible jobs, deliberately independent of the active filter: the
 * tabs have to show every status's count while you are looking at one of them.
 */
export async function getJobCounts(): Promise<JobCounts> {
  const counts = emptyJobCounts();
  const db = await getDatabase();

  if (db) {
    const rows = (await db.select(
      `SELECT status, COUNT(*) AS n FROM jobs
       WHERE (closed_at IS NULL OR status IN ('applied','shortlisted','rejected'))
       GROUP BY status;`
    )) as Array<{ status: string; n: number }>;

    for (const row of rows) {
      if (!isJobStatus(row.status)) continue;
      counts[row.status] = Number(row.n) || 0;
    }
    counts.total = JOB_STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);
    counts.unscored = await countUnscoredJobs();
    return counts;
  }

  const visible = readLocal<Job[]>(LS_JOBS, []).filter(isVisible);
  for (const job of visible) counts[job.status] += 1;
  counts.total = visible.length;
  counts.unscored = visible.filter((job) => job.relevanceScore === null && job.description).length;
  return counts;
}

/** Inserts new listings and refreshes known ones. Returns how many were written. */
export async function upsertJobs(drafts: JobDraft[]): Promise<number> {
  const valid = drafts.filter((draft) => draft.title.trim() && (draft.jobUrl ?? "").trim());
  if (valid.length === 0) return 0;

  const now = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    for (const draft of valid) {
      await db.execute(
        `INSERT INTO jobs (id, source, external_id, job_url, title, company, location,
           workplace_type, description, status, posted_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'saved',$10,$11)
         ON CONFLICT(source, external_id) DO UPDATE SET
           job_url = excluded.job_url,
           title = excluded.title,
           company = excluded.company,
           location = excluded.location,
           workplace_type = excluded.workplace_type,
           description = COALESCE(excluded.description, jobs.description),
           posted_at = excluded.posted_at,
           closed_at = NULL;`,
        [
          newJobId("job"),
          draft.source,
          draft.externalId,
          draft.jobUrl,
          draft.title.trim(),
          blank(draft.company),
          blank(draft.location),
          blank(draft.workplaceType),
          blank(draft.description),
          draft.postedAt ?? null,
          now,
        ]
      );
    }
    return valid.length;
  }

  const stored = readLocal<Job[]>(LS_JOBS, []);
  for (const draft of valid) {
    const key = draft.externalId
      ? stored.find((job) => job.source === draft.source && job.externalId === draft.externalId)
      : undefined;
    if (key) {
      key.jobUrl = draft.jobUrl;
      key.title = draft.title.trim();
      key.company = blank(draft.company);
      key.location = blank(draft.location);
      key.workplaceType = blank(draft.workplaceType);
      key.description = blank(draft.description) ?? key.description;
      key.postedAt = draft.postedAt ?? null;
      key.closedAt = null;
      continue;
    }
    stored.unshift({
      id: newJobId("job"),
      source: draft.source,
      externalId: draft.externalId,
      jobUrl: draft.jobUrl,
      title: draft.title.trim(),
      company: blank(draft.company),
      location: blank(draft.location),
      workplaceType: blank(draft.workplaceType),
      description: blank(draft.description),
      status: "saved",
      relevanceScore: null,
      relevanceReasoning: null,
      postedAt: draft.postedAt ?? null,
      createdAt: now,
      statusUpdatedAt: null,
      closedAt: null,
    });
  }
  writeLocal(LS_JOBS, stored);
  return valid.length;
}

/**
 * Writes stored jobs back exactly as they were.
 *
 * Only the browser-storage import uses this. `upsertJobs` is for listings a scan
 * has just found, so it mints a new id, forces the status to "saved" and would
 * throw away everything the user has decided about a job: applied, scored,
 * archived, closed.
 */
export async function restoreJobs(jobs: Job[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const db = await getDatabase();
  if (!db) return 0;

  for (const job of jobs) {
    await db.execute(
      `INSERT INTO jobs (id, source, external_id, job_url, title, company, location,
         workplace_type, description, status, relevance_score, relevance_reasoning,
         posted_at, created_at, status_updated_at, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         relevance_score = excluded.relevance_score,
         relevance_reasoning = excluded.relevance_reasoning,
         description = COALESCE(excluded.description, jobs.description),
         status_updated_at = excluded.status_updated_at,
         closed_at = excluded.closed_at;`,
      [
        job.id,
        job.source,
        job.externalId,
        job.jobUrl,
        job.title,
        job.company,
        job.location,
        job.workplaceType,
        job.description,
        job.status,
        job.relevanceScore,
        job.relevanceReasoning,
        job.postedAt,
        job.createdAt,
        job.statusUpdatedAt,
        job.closedAt,
      ]
    );
  }
  return jobs.length;
}

/**
 * Adds a job you found yourself.
 *
 * Manual entries carry no external id, so they never collide with a source's
 * listings and are never diff-closed.
 */
export async function insertManualJob(input: {
  title: string;
  company?: string | null;
  location?: string | null;
  jobUrl?: string | null;
  description: string;
}): Promise<Job> {
  const job: Job = {
    id: newJobId("job"),
    source: "manual",
    externalId: null,
    jobUrl: blank(input.jobUrl),
    title: input.title.trim(),
    company: blank(input.company),
    location: blank(input.location),
    workplaceType: null,
    description: input.description.trim(),
    status: "saved",
    relevanceScore: null,
    relevanceReasoning: null,
    postedAt: null,
    createdAt: new Date().toISOString(),
    statusUpdatedAt: null,
    closedAt: null,
  };
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `INSERT INTO jobs (id, source, external_id, job_url, title, company, location,
         workplace_type, description, status, created_at)
       VALUES ($1,'manual',NULL,$2,$3,$4,$5,NULL,$6,'saved',$7);`,
      [job.id, job.jobUrl, job.title, job.company, job.location, job.description, job.createdAt]
    );
    return job;
  }

  const stored = readLocal<Job[]>(LS_JOBS, []);
  stored.unshift(job);
  writeLocal(LS_JOBS, stored);
  return job;
}

/** URLs already stored for a source, so LinkedIn only fetches unknown details. */
export async function getExistingJobUrls(source: string, urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const db = await getDatabase();
  if (db) {
    const placeholders = urls.map((_, index) => `$${index + 2}`).join(", ");
    const rows = (await db.select(
      `SELECT job_url FROM jobs WHERE source = $1 AND job_url IN (${placeholders});`,
      [source, ...urls]
    )) as any[];
    return new Set(rows.map((row) => row.job_url));
  }
  return new Set(
    readLocal<Job[]>(LS_JOBS, [])
      .filter((job) => job.source === source && job.jobUrl && urls.includes(job.jobUrl))
      .map((job) => job.jobUrl as string)
  );
}

/** Status and/or a pasted description. Everything else is owned by the source. */
export async function updateJob(
  id: string,
  patch: { status?: Job["status"]; description?: string }
): Promise<void> {
  const now = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    if (patch.status) {
      await db.execute(`UPDATE jobs SET status = $1, status_updated_at = $2 WHERE id = $3;`, [
        patch.status,
        now,
        id,
      ]);
    }
    if (patch.description?.trim()) {
      await db.execute(`UPDATE jobs SET description = $1 WHERE id = $2;`, [patch.description.trim(), id]);
    }
    return;
  }

  const stored = readLocal<Job[]>(LS_JOBS, []);
  const job = stored.find((entry) => entry.id === id);
  if (!job) return;
  if (patch.status) {
    job.status = patch.status;
    job.statusUpdatedAt = now;
  }
  if (patch.description?.trim()) job.description = patch.description.trim();
  writeLocal(LS_JOBS, stored);
}

export async function saveJobScore(id: string, score: number, reasoning: string): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`UPDATE jobs SET relevance_score = $1, relevance_reasoning = $2 WHERE id = $3;`, [
      score,
      reasoning,
      id,
    ]);
    return;
  }
  const stored = readLocal<Job[]>(LS_JOBS, []);
  const job = stored.find((entry) => entry.id === id);
  if (!job) return;
  job.relevanceScore = score;
  job.relevanceReasoning = reasoning;
  writeLocal(LS_JOBS, stored);
}

/** How many jobs are waiting to be scored. Kept in step with `getUnscoredJobs`. */
export async function countUnscoredJobs(): Promise<number> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE relevance_score IS NULL AND description IS NOT NULL
         AND (closed_at IS NULL OR status IN ('applied','shortlisted','rejected'));`
    )) as Array<{ n: number }>;
    return Number(rows[0]?.n) || 0;
  }
  return readLocal<Job[]>(LS_JOBS, []).filter(
    (job) => isVisible(job) && job.relevanceScore === null && job.description
  ).length;
}

/**
 * Unscored jobs that actually have a description to score against.
 *
 * Mirrors `isVisible`, so a closed listing you never acted on is never picked up
 * by the scoring backlog — nothing should be sent to a model that the list
 * would not show you.
 */
export async function getUnscoredJobs(limit = 25): Promise<Job[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM jobs
       WHERE relevance_score IS NULL AND description IS NOT NULL
         AND (closed_at IS NULL OR status IN ('applied','shortlisted','rejected'))
       ORDER BY created_at DESC LIMIT $1;`,
      [limit]
    )) as any[];
    return rows.map(rowToJob);
  }
  return readLocal<Job[]>(LS_JOBS, [])
    .filter((job) => isVisible(job) && job.relevanceScore === null && job.description)
    .slice(0, limit);
}

/** Jobs with a link but no description yet - candidates for a page fetch. */
export async function getJobsMissingDescription(limit = 10): Promise<Job[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM jobs
       WHERE description IS NULL AND job_url IS NOT NULL AND job_url <> ''
       ORDER BY created_at DESC LIMIT $1;`,
      [limit]
    )) as any[];
    return rows.map(rowToJob);
  }
  return readLocal<Job[]>(LS_JOBS, [])
    .filter((job) => !job.description && job.jobUrl)
    .slice(0, limit);
}

/**
 * Flags portal listings that vanished from a source's latest scan.
 *
 * Only called after a successful, non-empty fetch, so a source that is simply
 * down never mass-closes its jobs.
 */
export async function markMissingJobsClosed(source: string, seen: string[]): Promise<number> {
  const now = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    const placeholders = seen.map((_, index) => `$${index + 2}`).join(", ");
    const clause = seen.length ? `AND external_id NOT IN (${placeholders})` : "";
    await db.execute(
      `UPDATE jobs SET closed_at = $1
       WHERE source = $2 AND closed_at IS NULL AND external_id IS NOT NULL ${clause};`,
      [now, source, ...seen]
    );
    return 0;
  }

  const stored = readLocal<Job[]>(LS_JOBS, []);
  let closed = 0;
  for (const job of stored) {
    if (job.source !== source || job.closedAt || !job.externalId) continue;
    if (seen.includes(job.externalId)) continue;
    job.closedAt = now;
    closed += 1;
  }
  writeLocal(LS_JOBS, stored);
  return closed;
}
