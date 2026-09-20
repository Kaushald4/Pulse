/**
 * Where classifier output lands on items, and what still needs classifying.
 */
import type { PulseItem } from "../types";
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_ITEMS } from "./local-keys";
import { rowToItem } from "./rows";

/** Items that have never been classified, or whose content changed. */
export async function getUnclassifiedItems(limit = 60): Promise<PulseItem[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM items
       WHERE jev_at IS NULL OR content_hash IS NULL
       ORDER BY published_at DESC LIMIT $1;`,
      [limit]
    )) as any[];
    return rows.map(rowToItem);
  }
  return readLocal<PulseItem[]>(LS_ITEMS, [])
    .filter((item) => !item.classifiedAt || !item.contentHash)
    .slice(0, limit);
}

export interface ClassificationUpdate {
  id: string;
  category: PulseItem["category"];
  field: PulseItem["field"];
  topic: string;
  signal: number | null;
  primarySource: boolean | null;
  whyKey: string;
  classifierModel: string | null;
  classifierConfidence: number | null;
  contentHash: string;
  tags: string[];
  extractedResources: PulseItem["extractedResources"];
}

export async function applyClassifications(updates: ClassificationUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    for (const update of updates) {
      await db.execute(
        `UPDATE items SET
           category = $1, field = $2, topic = $3, signal = $4, primary_source = $5,
           why_key = $6, jev_model = $7, jev_confidence = $8, jev_at = $9,
           content_hash = $10, tags_json = $11, resources_json = $12
         WHERE id = $13;`,
        [
          update.category,
          update.field,
          update.topic,
          update.signal,
          update.primarySource === null ? null : update.primarySource ? 1 : 0,
          update.whyKey,
          update.classifierModel,
          update.classifierConfidence,
          now,
          update.contentHash,
          JSON.stringify(update.tags ?? []),
          JSON.stringify(update.extractedResources ?? []),
          update.id,
        ]
      );
    }
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const byId = new Map(updates.map((update) => [update.id, update]));
  for (const item of store) {
    const update = byId.get(item.id);
    if (!update) continue;
    item.category = update.category;
    item.field = update.field;
    item.topic = update.topic;
    item.signal = update.signal;
    item.primarySource = update.primarySource;
    item.whyKey = update.whyKey;
    item.classifierModel = update.classifierModel;
    item.classifierConfidence = update.classifierConfidence;
    item.classifiedAt = now;
    item.contentHash = update.contentHash;
    item.tags = update.tags;
    item.extractedResources = update.extractedResources;
  }
  writeLocal(LS_ITEMS, store);
}


export async function applyReasons(reasons: Map<string, string>): Promise<void> {
  if (reasons.size === 0) return;
  const db = await getDatabase();

  if (db) {
    for (const [id, why] of reasons) {
      await db.execute(`UPDATE items SET why = $1 WHERE id = $2;`, [why, id]);
    }
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  for (const item of store) {
    const why = reasons.get(item.id);
    if (why) item.why = why;
  }
  writeLocal(LS_ITEMS, store);
}

/* -------------------------------------------------------------------------- */
/* Stats + topics + resources                                                  */
/* -------------------------------------------------------------------------- */

