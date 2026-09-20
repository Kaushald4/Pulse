/**
 * Daily briefings: the candidates they are written from, and the stored result.
 */
import type { DailyBriefing, PulseItem } from "../types";
import { isToday, startOfToday } from "../utils";
import { getDatabase, readLocal, writeLocal } from "./client";
import { queryItems } from "./items";
import { LS_BRIEFINGS } from "./local-keys";
import { rowToBriefing } from "./rows";

/** Items published today on the local clock - the briefing's source material. */
export async function getBriefingCandidates(limit = 16): Promise<PulseItem[]> {
  const items = await queryItems({ sortBy: "recent", publishedSince: startOfToday() });
  return items.filter((item) => isToday(item.publishedAt)).slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Briefings                                                                   */
/* -------------------------------------------------------------------------- */

export async function getBriefing(date: string): Promise<DailyBriefing | null> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM briefing WHERE date = $1;`, [date])) as any[];
    const row = rows[0];
    if (!row) return null;
    return rowToBriefing(row);
  }

  const briefings = readLocal<Record<string, DailyBriefing>>(LS_BRIEFINGS, {});
  return briefings[date] ?? null;
}


/** Every stored briefing, for library export. */
export async function getAllBriefings(): Promise<DailyBriefing[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM briefing;`)) as any[];
    return rows.map(rowToBriefing);
  }
  return Object.values(readLocal<Record<string, DailyBriefing>>(LS_BRIEFINGS, {}));
}

export async function saveBriefing(briefing: DailyBriefing): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(
      `INSERT INTO briefing (date, title, summary, key_happenings_json, sources_json, item_ids_json, model, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(date) DO UPDATE SET
         title = excluded.title,
         summary = excluded.summary,
         key_happenings_json = excluded.key_happenings_json,
         sources_json = excluded.sources_json,
         item_ids_json = excluded.item_ids_json,
         model = excluded.model,
         created_at = excluded.created_at;`,
      [
        briefing.date,
        briefing.title,
        briefing.summary,
        JSON.stringify(briefing.keyHappenings ?? []),
        JSON.stringify(briefing.sourcesUsed ?? []),
        JSON.stringify(briefing.itemIds ?? []),
        briefing.model ?? null,
        briefing.generatedAt ?? new Date().toISOString(),
      ]
    );
    return;
  }

  const briefings = readLocal<Record<string, DailyBriefing>>(LS_BRIEFINGS, {});
  briefings[briefing.date] = briefing;
  writeLocal(LS_BRIEFINGS, briefings);
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

