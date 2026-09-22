/**
 * Small app-level markers: facts about the app rather than about the reader's
 * content, kept in `app_meta` on the desktop and in localStorage in the browser
 * preview, so both behave the same.
 */
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_META } from "./local-keys";

/** When the feed was last opened, for "new since you last looked". */
export const FEED_SEEN_AT = "feed_seen_at";

export async function readMarker(key: string): Promise<string | null> {
  const db = await getDatabase();

  if (db) {
    const rows = (await db.select(`SELECT value FROM app_meta WHERE key = $1;`, [key])) as Array<{
      value: string;
    }>;
    return rows[0]?.value ?? null;
  }

  const store = readLocal<Record<string, string>>(LS_META, {});
  return store[key] ?? null;
}

export async function writeMarker(key: string, value: string): Promise<void> {
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `INSERT INTO app_meta (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      [key, value]
    );
    return;
  }

  const store = readLocal<Record<string, string>>(LS_META, {});
  store[key] = value;
  writeLocal(LS_META, store);
}
