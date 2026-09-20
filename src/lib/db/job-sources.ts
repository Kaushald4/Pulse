/**
 * Configured job sources: the built-in boards plus any company career pages
 * you track. Everything else about ingestion reads from here.
 */
import type { JobSource } from "../jobs/types";
import { defaultJobSources } from "../jobs/defaults";
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_JOB_SOURCES, newJobId, rowToJobSource } from "./jobs-common";

async function persist(db: any, source: JobSource): Promise<void> {
  await db.execute(
    `INSERT INTO job_sources (id, name, provider, careers_url, api, max_pages, enabled, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, provider = excluded.provider,
       careers_url = excluded.careers_url, api = excluded.api,
       max_pages = excluded.max_pages, enabled = excluded.enabled;`,
    [
      source.id,
      source.name,
      source.provider,
      source.careersUrl,
      source.api,
      source.maxPages,
      source.enabled ? 1 : 0,
      source.createdAt,
    ]
  );
}

export async function getJobSources(): Promise<JobSource[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM job_sources ORDER BY created_at ASC, name ASC;`
    )) as any[];
    if (rows.length > 0) return rows.map(rowToJobSource);

    const seeded = defaultJobSources();
    for (const source of seeded) await persist(db, source);
    return seeded;
  }

  const stored = readLocal<JobSource[]>(LS_JOB_SOURCES, []);
  if (stored.length > 0) return stored;
  const seeded = defaultJobSources();
  writeLocal(LS_JOB_SOURCES, seeded);
  return seeded;
}

export async function saveJobSource(input: {
  id?: string;
  name: string;
  provider?: string | null;
  careersUrl?: string | null;
  api?: string | null;
  maxPages?: number | null;
  enabled?: boolean;
}): Promise<JobSource> {
  const source: JobSource = {
    id: input.id ?? newJobId("source"),
    name: input.name.trim(),
    provider: input.provider?.trim() || null,
    careersUrl: input.careersUrl?.trim() || null,
    api: input.api?.trim() || null,
    maxPages: input.maxPages ?? null,
    enabled: input.enabled !== false,
    createdAt: new Date().toISOString(),
  };
  const db = await getDatabase();

  if (db) {
    await persist(db, source);
    return source;
  }

  const stored = readLocal<JobSource[]>(LS_JOB_SOURCES, []);
  const existing = stored.findIndex((entry) => entry.id === source.id);
  if (existing >= 0) stored[existing] = { ...source, createdAt: stored[existing].createdAt };
  else stored.push(source);
  writeLocal(LS_JOB_SOURCES, stored);
  return source;
}

export async function setJobSourceEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`UPDATE job_sources SET enabled = $1 WHERE id = $2;`, [enabled ? 1 : 0, id]);
    return;
  }
  const stored = readLocal<JobSource[]>(LS_JOB_SOURCES, []);
  const source = stored.find((entry) => entry.id === id);
  if (!source) return;
  source.enabled = enabled;
  writeLocal(LS_JOB_SOURCES, stored);
}

export async function deleteJobSource(id: string): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM job_sources WHERE id = $1;`, [id]);
    return;
  }
  writeLocal(
    LS_JOB_SOURCES,
    readLocal<JobSource[]>(LS_JOB_SOURCES, []).filter((entry) => entry.id !== id)
  );
}
