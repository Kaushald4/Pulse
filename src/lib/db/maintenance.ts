/**
 * Library-level operations: the sample content button, and erasing everything.
 */
import { getDatabase, readLocal, writeLocal } from "./client";
import { INITIAL_SAMPLE_ITEMS } from "../sources/sample-data";
import { upsertItems } from "./items";
import { LS_JOBS } from "./jobs-common";
import { LS_BRIEFINGS, LS_ITEMS, LS_RUNS } from "./local-keys";

export async function loadDemoData(): Promise<number> {
  await upsertItems(INITIAL_SAMPLE_ITEMS);
  return INITIAL_SAMPLE_ITEMS.length;
}

/**
 * Everything Pulse collected, in one go.
 *
 * Collected content and its history: items, briefings, run records and the job
 * listings. Deliberately not the inputs - the configured sources and job boards,
 * the uploaded resume and the model settings are the user's own, and a reset of
 * what was gathered should not make them set those up again.
 */
export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM items;`);
    await db.execute(`DELETE FROM briefing;`);
    await db.execute(`DELETE FROM runs;`);
    await db.execute(`DELETE FROM jobs;`);
    return;
  }
  writeLocal(LS_ITEMS, []);
  writeLocal(LS_BRIEFINGS, {});
  writeLocal(LS_RUNS, []);
  writeLocal(LS_JOBS, []);
}
