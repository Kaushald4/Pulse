/**
 * Daily briefings: the candidates they are written from, and the stored result.
 */
import type { DailyBriefing, PulseItem } from "../types";
import { byImportance, diversify } from "../feed/ranking";
import { startOfToday } from "../utils";
import { getDatabase, readLocal, writeLocal } from "./client";
import { queryItems } from "./items";
import { LS_BRIEFINGS } from "./local-keys";
import { rowToBriefing } from "./rows";

/**
 * Today's pool: published today, or collected today.
 *
 * "Collected today" matters as much as "published today" - a paper or a repo
 * published last week is still new to you on the day it arrives.
 */
async function candidatePool(): Promise<PulseItem[]> {
  const since = startOfToday();
  const [published, collected] = await Promise.all([
    queryItems({ sortBy: "recent", publishedSince: since }),
    queryItems({ sortBy: "recent", collectedSince: since }),
  ]);

  const byId = new Map<string, PulseItem>();
  for (const item of [...published, ...collected]) byId.set(item.id, item);
  return Array.from(byId.values());
}

/**
 * What the briefing is written from.
 *
 * Two properties matter more than the exact ordering: no single source may
 * dominate, and none of this requires a classifier to have run.
 */
export async function getBriefingCandidates(limit = 16): Promise<PulseItem[]> {
  const pool = (await candidatePool()).filter(
    (item) => item.title.trim().length > 0 && item.url.trim().length > 0
  );
  if (pool.length === 0) return [];
  return diversify(pool.sort(byImportance), {
    limit,
    sourceOf: (item) => item.source,
    keyOf: (item) => item.id,
  });
}

/**
 * Topic counts within the pool the briefing is written from.
 *
 * Counted from the same items the model is shown, so every number in the prompt
 * is traceable to something it can see. It used to be handed week-long counts
 * alongside a single day of items, and duly reported the mismatch in the
 * briefing. `other` is the classifier's no-match outcome, not a topic.
 */
export function topicsInPool(pool: PulseItem[]): Array<{ topic: string; count: number }> {
  const counts = new Map<string, number>();

  for (const item of pool) {
    const topic = item.topic?.trim();
    if (!topic || topic === "other") continue;
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }

  return Array.from(counts, ([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, 6);
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
