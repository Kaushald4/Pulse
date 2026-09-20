/**
 * Personal signal: learned preferences, watchlists, projects and the sync
 * schedule - everything that is about you rather than about the content.
 */
import type { Project, PulseSchedule, SignalPreference, Watchlist } from "../types";
import { getDatabase, readLocal, writeLocal } from "./client";
import {
  LS_PREFERENCES,
  LS_PROJECTS,
  LS_SCHEDULE,
  LS_WATCHLISTS,
} from "./local-keys";

function newId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${uuid}`;
}

export async function getSignalPreferences(): Promise<SignalPreference[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT id, kind, value, weight, evidence, updated_at FROM signal_preferences ORDER BY weight DESC;`)) as any[];
    return rows.map((row) => ({ id: row.id, kind: row.kind, value: row.value, weight: row.weight, evidence: row.evidence, updatedAt: row.updated_at }));
  }
  return readLocal<SignalPreference[]>(LS_PREFERENCES, []);
}

export async function recordSignalFeedback(
  kind: SignalPreference["kind"],
  value: string,
  direction: 1 | -1
): Promise<void> {
  const normalized = value.trim();
  if (!normalized) return;
  const id = `${kind}:${normalized.toLowerCase()}`;
  const now = new Date().toISOString();
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO signal_preferences (id, kind, value, weight, evidence, updated_at)
       VALUES ($1,$2,$3,$4,1,$5)
       ON CONFLICT(id) DO UPDATE SET weight = MAX(-1.5, MIN(1.5, signal_preferences.weight + $4)),
       evidence = signal_preferences.evidence + 1, updated_at = $5;`,
      [id, kind, normalized, direction * 0.25, now]
    );
    return;
  }
  const preferences = readLocal<SignalPreference[]>(LS_PREFERENCES, []);
  const existing = preferences.find((preference) => preference.id === id);
  if (existing) {
    existing.weight = Math.max(-1.5, Math.min(1.5, existing.weight + direction * 0.25));
    existing.evidence += 1;
    existing.updatedAt = now;
  } else {
    preferences.push({ id, kind, value: normalized, weight: direction * 0.25, evidence: 1, updatedAt: now });
  }
  writeLocal(LS_PREFERENCES, preferences);
}

export async function saveSignalPreferences(preferences: SignalPreference[]): Promise<void> {
  const db = await getDatabase();
  if (db) {
    for (const preference of preferences) {
      await db.execute(
        `INSERT INTO signal_preferences (id, kind, value, weight, evidence, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET weight = excluded.weight, evidence = excluded.evidence, updated_at = excluded.updated_at;`,
        [preference.id, preference.kind, preference.value, preference.weight, preference.evidence, preference.updatedAt]
      );
    }
    return;
  }
  writeLocal(LS_PREFERENCES, preferences);
}

export async function getWatchlists(): Promise<Watchlist[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM watchlists ORDER BY created_at DESC;`)) as any[];
    return rows.map((row) => ({ id: row.id, name: row.name, query: row.query, enabled: Boolean(row.enabled), createdAt: row.created_at }));
  }
  return readLocal<Watchlist[]>(LS_WATCHLISTS, []);
}

export async function saveWatchlist(watchlist: Watchlist): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO watchlists (id, name, query, enabled, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, query = excluded.query, enabled = excluded.enabled;`,
      [watchlist.id, watchlist.name, watchlist.query, watchlist.enabled ? 1 : 0, watchlist.createdAt]
    );
    return;
  }
  const list = readLocal<Watchlist[]>(LS_WATCHLISTS, []);
  const index = list.findIndex((entry) => entry.id === watchlist.id);
  if (index === -1) list.unshift(watchlist);
  else list[index] = watchlist;
  writeLocal(LS_WATCHLISTS, list);
}

export async function deleteWatchlist(id: string): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM watchlists WHERE id = $1;`, [id]);
    return;
  }
  writeLocal(LS_WATCHLISTS, readLocal<Watchlist[]>(LS_WATCHLISTS, []).filter((entry) => entry.id !== id));
}

export async function getProjects(): Promise<Project[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM projects ORDER BY created_at DESC;`)) as any[];
    const itemRows = (await db.select(`SELECT project_id, item_id FROM project_items;`)) as any[];
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, createdAt: row.created_at, itemIds: itemRows.filter((item) => item.project_id === row.id).map((item) => item.item_id) }));
  }
  return readLocal<Project[]>(LS_PROJECTS, []);
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO projects (id, name, description, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description;`,
      [project.id, project.name, project.description, project.createdAt]
    );
    await db.execute(`DELETE FROM project_items WHERE project_id = $1;`, [project.id]);
    for (const itemId of project.itemIds) await db.execute(`INSERT INTO project_items (project_id, item_id) VALUES ($1,$2);`, [project.id, itemId]);
    return;
  }
  const projects = readLocal<Project[]>(LS_PROJECTS, []);
  const index = projects.findIndex((entry) => entry.id === project.id);
  if (index === -1) projects.unshift(project);
  else projects[index] = project;
  writeLocal(LS_PROJECTS, projects);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM project_items WHERE project_id = $1;`, [id]);
    await db.execute(`DELETE FROM projects WHERE id = $1;`, [id]);
    return;
  }
  writeLocal(LS_PROJECTS, readLocal<Project[]>(LS_PROJECTS, []).filter((entry) => entry.id !== id));
}

export async function getSchedule(): Promise<PulseSchedule> {
  const fallback: PulseSchedule = { id: "default", enabled: false, intervalMinutes: 360, notify: true };
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM pulse_schedule WHERE id = 'default' LIMIT 1;`)) as any[];
    const row = rows[0];
    return row ? { id: row.id, enabled: Boolean(row.enabled), intervalMinutes: row.interval_minutes, notify: Boolean(row.notify), lastRunAt: row.last_run_at, nextRunAt: row.next_run_at } : fallback;
  }
  return readLocal<PulseSchedule>(LS_SCHEDULE, fallback);
}

export async function saveSchedule(schedule: PulseSchedule): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO pulse_schedule (id, enabled, interval_minutes, notify, last_run_at, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, interval_minutes = excluded.interval_minutes,
       notify = excluded.notify, last_run_at = excluded.last_run_at, next_run_at = excluded.next_run_at;`,
      [schedule.id, schedule.enabled ? 1 : 0, schedule.intervalMinutes, schedule.notify ? 1 : 0, schedule.lastRunAt ?? null, schedule.nextRunAt ?? null]
    );
    return;
  }
  writeLocal(LS_SCHEDULE, schedule);
}

export function createWatchlist(name: string, query: string): Watchlist {
  return { id: newId("watch"), name: name.trim(), query: query.trim(), enabled: true, createdAt: new Date().toISOString() };
}

export function createProject(name: string, description = ""): Project {
  return { id: newId("project"), name: name.trim(), description: description.trim(), createdAt: new Date().toISOString(), itemIds: [] };
}

/** Items that have never been classified, or whose content changed. */
