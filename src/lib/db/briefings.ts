/**
 * Daily briefings: the candidates they are written from, and the stored result.
 */
import type { DailyBriefing, PulseItem } from "../types";
import { startOfToday } from "../utils";
import { getDatabase, readLocal, writeLocal } from "./client";
import { queryItems } from "./items";
import { LS_BRIEFINGS } from "./local-keys";
import { rowToBriefing } from "./rows";

/** How many items one source may contribute before the others get a turn. */
const MAX_PER_SOURCE = 3;

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
 * Importance with no classifier involved.
 *
 * Engagement is the only ranking signal that is present on every item whatever
 * the user has configured. Logarithmic on purpose: a 900-point thread is not
 * thirty times as useful as a 30-point one.
 */
function engagement(item: PulseItem): number {
  return Math.log1p(Math.max(0, item.score) + Math.max(0, item.commentsCount) * 2);
}

/**
 * Classifier score when there is one, engagement otherwise.
 *
 * Both classifier engines - Jev and the LLM JSON-mode one - write `signal`, so
 * this is not engine-specific. It falls back for the window before a classifier
 * has run over an item: a fresh sync, a partial failure, or no provider key
 * configured yet. Scoring is incremental, so part of the pool having a score is
 * normal rather than an edge case.
 */
function byImportance(a: PulseItem, b: PulseItem): number {
  const aScored = typeof a.signal === "number";
  const bScored = typeof b.signal === "number";
  if (aScored !== bScored) return aScored ? -1 : 1;
  if (aScored && bScored && a.signal !== b.signal) {
    return (b.signal as number) - (a.signal as number);
  }
  return engagement(b) - engagement(a);
}

/**
 * Caps how many items one source may contribute, then tops up in rank order if
 * the pool is too narrow to fill the budget.
 *
 * Without the cap a single fast-moving feed takes every slot: on a busy Reddit
 * day all sixteen candidates were Reddit threads, which is why the briefing had
 * nothing technical to say.
 */
function diversify(ranked: PulseItem[], limit: number): PulseItem[] {
  const chosen: PulseItem[] = [];
  const perSource = new Map<string, number>();

  for (const item of ranked) {
    if (chosen.length === limit) return chosen;
    const used = perSource.get(item.source) ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    perSource.set(item.source, used + 1);
    chosen.push(item);
  }

  if (chosen.length < limit) {
    const taken = new Set(chosen.map((item) => item.id));
    for (const item of ranked) {
      if (chosen.length === limit) break;
      if (taken.has(item.id)) continue;
      chosen.push(item);
    }
  }

  return chosen;
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
  return diversify(pool.sort(byImportance), limit);
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
