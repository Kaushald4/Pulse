/**
 * Library-level operations: the sample content button, and erasing everything.
 */
import { getDatabase, readLocal, writeLocal } from "./client";
import { INITIAL_SAMPLE_ITEMS } from "../sources/sample-data";
import { upsertItems } from "./items";
import { LS_BRIEFINGS, LS_ITEMS, LS_RUNS } from "./local-keys";

export async function loadDemoData(): Promise<number> {
  await upsertItems(INITIAL_SAMPLE_ITEMS);
  return INITIAL_SAMPLE_ITEMS.length;
}

export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM items;`);
    await db.execute(`DELETE FROM briefing;`);
    await db.execute(`DELETE FROM runs;`);
    return;
  }
  writeLocal(LS_ITEMS, []);
  writeLocal(LS_BRIEFINGS, {});
  writeLocal(LS_RUNS, []);
}
