/**
 * Where classifier output lands on items, and what still needs classifying.
 */
import type { PulseItem } from "../types";
import { hashContent } from "../utils";
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_ITEMS } from "./local-keys";
import { rowToItem } from "./rows";

/**
 * Whether an item needs classifying: never labelled, no recorded hash, or the
 * content moved on since the label was written.
 *
 * `content_hash` belongs to the *classification*, not to the item. Refreshing it
 * on ingest would erase the only record of which content a label came from,
 * which is exactly the provenance the dataset export needs, so the comparison
 * happens here instead and nothing is overwritten.
 */
export function needsClassification(item: PulseItem): boolean {
  if (!item.classifiedAt || !item.contentHash) return true;
  return item.contentHash !== hashContent(item.title, item.url, item.body);
}

/** Items that have never been classified, or whose content changed. */
export async function getUnclassifiedItems(limit = 60): Promise<PulseItem[]> {
  const db = await getDatabase();
  if (db) {
    // The current hash is computed in JavaScript, not SQL, so the candidates are
    // read and filtered here rather than narrowed by a query. At a few thousand
    // rows that costs a few milliseconds. If the library ever grows enough for it
    // to matter, the answer is a fingerprint written at ingest, never a narrower
    // query, which would silently skip changed rows.
    const rows = (await db.select(`SELECT * FROM items ORDER BY published_at DESC;`)) as any[];
    return rows.map(rowToItem).filter(needsClassification).slice(0, limit);
  }
  return readLocal<PulseItem[]>(LS_ITEMS, []).filter(needsClassification).slice(0, limit);
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
