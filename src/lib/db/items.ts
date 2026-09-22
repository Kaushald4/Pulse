/**
 * Content items: writing them, querying them, and the per-item edits the UI makes.
 */
import type { ItemState, PulseFilter, PulseItem, SortKey } from "../types";
import { groupKeyFor } from "../feed/canonical";
import { groupFromAggregates, groupItems, type FeedGroup } from "../feed/grouping";
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_ITEMS } from "./local-keys";
import { rowToItem } from "./rows";

export async function upsertItems(items: PulseItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDatabase();

  if (db) {
    for (const item of items) {
      await db.execute(
        `INSERT INTO items (
           id, source, source_type, category, field, title, url, body, author, author_url,
           score, comments_count, published_at, state, tags_json, resources_json, created_at,
           topic, signal, primary_source, why_key, why, jev_model, jev_confidence, jev_at, content_hash,
           image_url, site_name, link_description, link_checked_at, canonical_url
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
         ON CONFLICT(id) DO UPDATE SET
           score = excluded.score,
           comments_count = excluded.comments_count,
           published_at = excluded.published_at,
           image_url = COALESCE(excluded.image_url, items.image_url),
           site_name = COALESCE(excluded.site_name, items.site_name),
           link_description = COALESCE(excluded.link_description, items.link_description),
           field = COALESCE(excluded.field, items.field),
           category = COALESCE(excluded.category, items.category),
           canonical_url = excluded.canonical_url;`,
        [
          item.id,
          item.source,
          item.sourceType,
          item.category,
          item.field,
          item.title,
          item.url,
          item.body,
          item.author,
          item.authorUrl,
          item.score,
          item.commentsCount,
          item.publishedAt,
          item.state,
          JSON.stringify(item.tags ?? []),
          JSON.stringify(item.extractedResources ?? []),
          item.createdAt,
          item.topic ?? null,
          item.signal ?? null,
          item.primarySource === null || item.primarySource === undefined ? null : item.primarySource ? 1 : 0,
          item.whyKey ?? null,
          item.why ?? null,
          item.classifierModel ?? null,
          item.classifierConfidence ?? null,
          item.classifiedAt ?? null,
          item.contentHash ?? null,
          item.imageUrl ?? null,
          item.siteName ?? null,
          item.linkDescription ?? null,
          item.linkCheckedAt ?? null,
          groupKeyFor({ id: item.id, url: item.url }),
        ]
      );
    }
    return;
  }

  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const map = new Map(store.map((item) => [item.id, item]));
  for (const item of items) {
    const existing = map.get(item.id);
    map.set(item.id, existing ? { ...item, state: existing.state } : item);
  }
  writeLocal(LS_ITEMS, Array.from(map.values()));
}

/**
 * The WHERE clauses a filter contributes, plus their parameters.
 *
 * Shared by the item query, the grouped feed query and the facet counts, so a
 * filter cannot mean one thing on the feed and another everywhere else.
 */
export function itemFilterClauses(filter: PulseFilter): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const add = (clause: string, value: unknown) => {
    params.push(value);
    conditions.push(clause.replace("?", `$${params.length}`));
  };

  if (filter.category && filter.category !== "all") add("category = ?", filter.category);
  if (filter.field && filter.field !== "all") add("field = ?", filter.field);
  if (filter.state) add("state = ?", filter.state);
  if (filter.source) add("source = ?", filter.source);
  if (filter.query?.trim()) {
    params.push(`%${filter.query.trim()}%`);
    const p = `$${params.length}`;
    conditions.push(`(title LIKE ${p} OR body LIKE ${p} OR author LIKE ${p})`);
  }
  if (filter.tag) add("tags_json LIKE ?", `%${filter.tag}%`);
  if (filter.publishedSince) add("published_at >= ?", filter.publishedSince);
  if (filter.collectedSince) add("created_at >= ?", filter.collectedSince);

  return { conditions, params };
}

export async function queryItems(filter: PulseFilter = {}): Promise<PulseItem[]> {
  const db = await getDatabase();

  if (db) {
    const { conditions, params } = itemFilterClauses(filter);

    const orderBy = {
      // Classified items first, then by the classifier's score, then by
      // engagement. Same rule as byImportance, expressed for SQL.
      best: "signal IS NULL, signal DESC, (COALESCE(score, 0) + COALESCE(comments_count, 0) * 2) DESC, published_at DESC",
      recent: "published_at DESC",
      score: "score DESC, published_at DESC",
      comments: "comments_count DESC, published_at DESC",
    }[filter.sortBy ?? "recent"];

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = (await db.select(
      `SELECT * FROM items ${where} ORDER BY ${orderBy} LIMIT 200;`,
      params
    )) as any[];
    return rows.map(rowToItem);
  }

  let list = readLocal<PulseItem[]>(LS_ITEMS, []);
  if (filter.category && filter.category !== "all") list = list.filter((i) => i.category === filter.category);
  if (filter.field && filter.field !== "all") list = list.filter((i) => i.field === filter.field);
  if (filter.state) list = list.filter((i) => i.state === filter.state);
  if (filter.source) list = list.filter((i) => i.source === filter.source);
  if (filter.query?.trim()) {
    const q = filter.query.toLowerCase();
    list = list.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.body ?? "").toLowerCase().includes(q) ||
        (i.author ?? "").toLowerCase().includes(q)
    );
  }
  if (filter.tag) list = list.filter((i) => i.tags.includes(filter.tag!));
  if (filter.publishedSince) {
    const since = filter.publishedSince;
    list = list.filter((i) => (i.publishedAt ?? "") >= since);
  }
  if (filter.collectedSince) {
    const since = filter.collectedSince;
    list = list.filter((i) => (i.createdAt ?? "") >= since);
  }

  return sortItems(list, filter.sortBy ?? "recent");
}

/** Item ids to items, for the grouped query's representatives. */
export async function getItemsByIds(ids: string[]): Promise<PulseItem[]> {
  if (ids.length === 0) return [];
  const db = await getDatabase();

  if (db) {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
    const rows = (await db.select(`SELECT * FROM items WHERE id IN (${placeholders});`, ids)) as any[];
    return rows.map(rowToItem);
  }

  const wanted = new Set(ids);
  return readLocal<PulseItem[]>(LS_ITEMS, []).filter((item) => wanted.has(item.id));
}

/**
 * One row per story rather than per item.
 *
 * SQLite groups and pages by story, so a story whose members straddle a page
 * boundary stays whole. The browser-preview path has no SQL, so the same rules
 * run in memory over the items it already reads.
 */
export async function queryFeedGroups(filter: PulseFilter = {}, limit = 200): Promise<FeedGroup[]> {
  const db = await getDatabase();

  if (!db) {
    return groupItems(await queryItems(filter)).slice(0, limit);
  }

  const { conditions, params } = itemFilterClauses(filter);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = {
    // The group's best signal and engagement, so a story ranks by its liveliest
    // copy rather than by whichever one happens to represent it.
    best: "top_signal IS NULL, top_signal DESC, (top_score + top_comments * 2) DESC, newest DESC",
    recent: "newest DESC",
    score: "top_score DESC, newest DESC",
    comments: "top_comments DESC, newest DESC",
  }[filter.sortBy ?? "recent"];

  // Rows that never got a key fall back to their own id, so they can never be
  // merged into one shared bucket.
  const key = `COALESCE(canonical_url, 'item:' || id)`;

  // Ranked first, so the representative and the aggregates come from one pass.
  // The ORDER BY here is the same rule as `pickRepresentative`.
  const rows = (await db.select(
    `WITH ranked AS (
       SELECT id, source, score, comments_count, published_at, signal,
              ${key} AS group_key,
              ROW_NUMBER() OVER (
                PARTITION BY ${key}
                ORDER BY (primary_source IS 1) DESC, score DESC, published_at DESC, id ASC
              ) AS place
       FROM items
       ${where}
     )
     SELECT group_key AS key,
            MIN(CASE WHEN place = 1 THEN id END) AS representative_id,
            COUNT(*) AS members,
            GROUP_CONCAT(DISTINCT source) AS sources,
            MAX(COALESCE(score, 0)) AS top_score,
            MAX(COALESCE(comments_count, 0)) AS top_comments,
            MAX(signal) AS top_signal,
            MAX(published_at) AS newest
     FROM ranked
     GROUP BY group_key
     ORDER BY ${orderBy}
     LIMIT $${params.length + 1};`,
    [...params, limit]
  )) as any[];

  const representatives = new Map(
    (await getItemsByIds(rows.map((row) => String(row.representative_id)))).map((item) => [item.id, item])
  );

  const groups: FeedGroup[] = [];
  for (const row of rows) {
    const representative = representatives.get(String(row.representative_id));
    // A representative can only be missing if it was deleted mid-query.
    if (!representative) continue;

    groups.push(
      groupFromAggregates({
        key: String(row.key),
        representative,
        members: Number(row.members) || 1,
        sources: String(row.sources ?? "")
          .split(",")
          .filter(Boolean),
        // Groups are ordered by this, so the card has to show it too.
        latestAt: String(row.newest ?? representative.publishedAt),
        topScore: Number(row.top_score) || 0,
        topComments: Number(row.top_comments) || 0,
      })
    );
  }

  return groups;
}

function sortItems(list: PulseItem[], sortBy: SortKey): PulseItem[] {
  const copy = [...list];
  if (sortBy === "score") {
    copy.sort((a, b) => b.score - a.score || time(b) - time(a));
  } else if (sortBy === "comments") {
    copy.sort((a, b) => b.commentsCount - a.commentsCount || time(b) - time(a));
  } else {
    copy.sort((a, b) => time(b) - time(a));
  }
  return copy;
}

const time = (item: PulseItem): number => new Date(item.publishedAt).getTime() || 0;

export async function updateItemState(id: string, state: ItemState): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`UPDATE items SET state = $1 WHERE id = $2;`, [state, id]);
    return;
  }
  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const index = store.findIndex((item) => item.id === id);
  if (index !== -1) {
    store[index] = { ...store[index], state };
    writeLocal(LS_ITEMS, store);
  }
}

export async function updateItemNotes(id: string, notes: string): Promise<void> {
  const db = await getDatabase();
  const value = notes.trim() || null;
  if (db) {
    await db.execute(`UPDATE items SET notes = $1 WHERE id = $2;`, [value, id]);
    return;
  }
  const store = readLocal<PulseItem[]>(LS_ITEMS, []);
  const item = store.find((entry) => entry.id === id);
  if (item) {
    item.notes = value;
    writeLocal(LS_ITEMS, store);
  }
}
