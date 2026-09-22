/**
 * Option counts for the feed's filter bar.
 *
 * Each facet is counted under the *other* active filters, which is what makes a
 * number honest: the count beside "Security" is what clicking it returns, with
 * the source and window filters still applied.
 *
 * Counts are stories, not rows. A story carried by three sources is one result,
 * so counting rows would overstate every option that touches a duplicate.
 *
 * The database path counts in SQL, because `queryItems` caps at 200 rows and a
 * capped count would be a lie. The browser preview has no SQL and no cap, so it
 * counts through the ordinary query instead.
 */
import { groupKeyFor } from "../feed/canonical";
import { FIELD_OPTIONS, WINDOWS, windowSince, type FeedFacets } from "../feed/facets";
import { FIELD_LABELS, SOURCE_LABELS, labelFor } from "../taxonomy";
import type { PulseFilter, PulseItem } from "../types";
import { getDatabase } from "./client";
import { itemFilterClauses, queryItems } from "./items";

/** Identifies a story, matching the grouped feed query. */
const STORY_KEY = `COALESCE(canonical_url, 'item:' || id)`;

/** A filter with one dimension removed, so that facet can count under the rest. */
function withoutFilter(filter: PulseFilter, drop: keyof PulseFilter): PulseFilter {
  const copy = { ...filter };
  delete copy[drop];
  return copy;
}

async function countStories(db: any, filter: PulseFilter): Promise<number> {
  const { conditions, params } = itemFilterClauses(filter);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = (await db.select(
    `SELECT COUNT(DISTINCT ${STORY_KEY}) AS stories FROM items ${where};`,
    params
  )) as Array<{ stories: number }>;
  return Number(rows[0]?.stories) || 0;
}

async function countStoriesBy(
  db: any,
  filter: PulseFilter,
  column: "field" | "source"
): Promise<Map<string, number>> {
  const { conditions, params } = itemFilterClauses(filter);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = (await db.select(
    `SELECT ${column} AS value, COUNT(DISTINCT ${STORY_KEY}) AS stories
     FROM items ${where}
     GROUP BY ${column}
     ORDER BY stories DESC;`,
    params
  )) as Array<{ value: string | null; stories: number }>;

  return new Map(rows.map((row) => [String(row.value ?? "other"), Number(row.stories) || 0]));
}

export async function getFeedFacets(filter: PulseFilter = {}): Promise<FeedFacets> {
  const db = await getDatabase();
  if (!db) return previewFacets(filter);

  const noWindow = withoutFilter(filter, "publishedSince");

  const [total, fieldCounts, sourceCounts, windows] = await Promise.all([
    countStories(db, filter),
    countStoriesBy(db, withoutFilter(filter, "field"), "field"),
    countStoriesBy(db, withoutFilter(filter, "source"), "source"),
    // One count per window: they are cheap, indexed, and each is easier to
    // check against the list it describes than a single clever query would be.
    Promise.all(
      WINDOWS.map(async (window) => ({
        value: window.value,
        label: window.label,
        count: await countStories(
          db,
          window.value === "all" ? noWindow : { ...noWindow, publishedSince: windowSince(window.value) }
        ),
      }))
    ),
  ]);

  return {
    total,
    fields: FIELD_OPTIONS.map((field) => ({
      value: field,
      label: FIELD_LABELS[field] ?? field,
      count: fieldCounts.get(field) ?? 0,
    })),
    sources: Array.from(sourceCounts, ([value, count]) => ({
      value,
      label: labelFor(SOURCE_LABELS, value, value),
      count,
    })),
    windows,
  };
}

/** The same counts without SQL, for the browser preview. */
async function previewFacets(filter: PulseFilter): Promise<FeedFacets> {
  const stories = async (candidate: PulseFilter): Promise<number> =>
    new Set((await queryItems(candidate)).map((item: PulseItem) => groupKeyFor(item))).size;

  const noWindow = withoutFilter(filter, "publishedSince");

  const [total, fields, sources, windows] = await Promise.all([
    stories(filter),
    Promise.all(
      FIELD_OPTIONS.map(async (field) => ({
        value: field as string,
        label: FIELD_LABELS[field] ?? field,
        count: await stories({ ...withoutFilter(filter, "field"), field }),
      }))
    ),
    (async () => {
      const items = await queryItems(withoutFilter(filter, "source"));
      const counts = new Map<string, Set<string>>();
      for (const item of items) {
        const keys = counts.get(item.source) ?? new Set<string>();
        keys.add(groupKeyFor(item));
        counts.set(item.source, keys);
      }
      return Array.from(counts, ([value, keys]) => ({
        value,
        label: labelFor(SOURCE_LABELS, value, value),
        count: keys.size,
      })).sort((a, b) => b.count - a.count);
    })(),
    Promise.all(
      WINDOWS.map(async (window) => ({
        value: window.value,
        label: window.label,
        count: await stories(
          window.value === "all" ? noWindow : { ...noWindow, publishedSince: windowSince(window.value) }
        ),
      }))
    ),
  ]);

  return { total, fields, sources, windows };
}
