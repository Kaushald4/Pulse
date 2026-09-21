/**
 * Dashboard numbers: library totals, and topic movement over the last two weeks.
 */
import type { PulseItem, PulseStats, TopicSummary } from "../types";
import { getDatabase, readLocal } from "./client";
import { queryItems } from "./items";
import { LS_ITEMS } from "./local-keys";
import { EMPTY_STATS } from "./rows";

export async function getPulseStats(): Promise<PulseStats> {
  const db = await getDatabase();

  if (db) {
    const rows = (await db.select(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN state='inbox' THEN 1 ELSE 0 END) AS inbox,
        SUM(CASE WHEN state='saved' THEN 1 ELSE 0 END) AS saved,
        SUM(CASE WHEN state='important' THEN 1 ELSE 0 END) AS important,
        SUM(CASE WHEN state='archived' THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN category='repo' THEN 1 ELSE 0 END) AS repos,
        SUM(CASE WHEN category='paper' THEN 1 ELSE 0 END) AS papers,
        SUM(CASE WHEN category='resource' THEN 1 ELSE 0 END) AS resources,
        SUM(CASE WHEN category='news' THEN 1 ELSE 0 END) AS news,
        SUM(CASE WHEN field='ai_ml' THEN 1 ELSE 0 END) AS ai_ml,
        SUM(CASE WHEN field='systems_infra' THEN 1 ELSE 0 END) AS systems,
        SUM(CASE WHEN field='web_frontend' THEN 1 ELSE 0 END) AS web,
        SUM(CASE WHEN field='developer_tools' THEN 1 ELSE 0 END) AS dev_tools,
        SUM(CASE WHEN field='security' THEN 1 ELSE 0 END) AS security,
        SUM(CASE WHEN field='data' THEN 1 ELSE 0 END) AS data,
        SUM(CASE WHEN field='other' THEN 1 ELSE 0 END) AS other
      FROM items;
    `)) as any[];
    const row = rows[0] ?? {};
    return {
      total: row.total ?? 0,
      inbox: row.inbox ?? 0,
      saved: row.saved ?? 0,
      important: row.important ?? 0,
      archived: row.archived ?? 0,
      repos: row.repos ?? 0,
      papers: row.papers ?? 0,
      resources: row.resources ?? 0,
      news: row.news ?? 0,
      aiMl: row.ai_ml ?? 0,
      systems: row.systems ?? 0,
      web: row.web ?? 0,
      devTools: row.dev_tools ?? 0,
      security: row.security ?? 0,
      data: row.data ?? 0,
      other: row.other ?? 0,
    };
  }

  const list = readLocal<PulseItem[]>(LS_ITEMS, []);
  if (list.length === 0) return { ...EMPTY_STATS };
  return {
    total: list.length,
    inbox: list.filter((i) => i.state === "inbox").length,
    saved: list.filter((i) => i.state === "saved").length,
    important: list.filter((i) => i.state === "important").length,
    archived: list.filter((i) => i.state === "archived").length,
    repos: list.filter((i) => i.category === "repo").length,
    papers: list.filter((i) => i.category === "paper").length,
    resources: list.filter((i) => i.category === "resource").length,
    news: list.filter((i) => i.category === "news").length,
    aiMl: list.filter((i) => i.field === "ai_ml").length,
    systems: list.filter((i) => i.field === "systems_infra").length,
    web: list.filter((i) => i.field === "web_frontend").length,
    devTools: list.filter((i) => i.field === "developer_tools").length,
    security: list.filter((i) => i.field === "security").length,
    data: list.filter((i) => i.field === "data").length,
    other: list.filter((i) => i.field === "other").length,
  };
}


const DAY = 86_400_000;
const TOPIC_WINDOW_DAYS = 7;
const MAX_RISING_TOPICS = 6;
/** A topic needs at least this many items in a window to be worth ranking. */
const MIN_TOPIC_ITEMS = 2;

/**
 * A percentage against a base smaller than this is noise, not movement.
 *
 * 1 -> 16 rendered as "+1500%" and 1 -> 4 as "+300%", which read as surges while
 * saying nothing. Below this base a row reports no delta instead.
 */
const MIN_DELTA_BASE = 5;

/**
 * Umbrella buckets, not movers. `other` is the classifier's no-match outcome, so
 * ranking it as a "rising topic" is meaningless. Mirrors journal's
 * `rejectMegaTopics`.
 */
const MEGA_TOPICS = new Set(["other"]);

/**
 * Topic activity for the current window versus the immediately preceding one -
 * journal's `getTopicVelocity` shape, computed over items rather than clustered
 * events (Pulse has no clustering layer).
 *
 * Three deliberate differences from a naive implementation:
 *  - Only the classifier's assigned `topic` counts. Falling back to `tags[0]`
 *    mixed unrelated keyword tags into the same ranking.
 *  - The window is bounded by date, not by "the newest N items": querying the
 *    newest rows first meant a busy day could fill the whole result set, leaving
 *    no prior window to compare against.
 *  - A percentage needs a base worth comparing to (`MIN_DELTA_BASE`), so tiny
 *    counts no longer render as enormous swings.
 */
export async function getTopicSummary(): Promise<TopicSummary> {
  // Bounded by the window we actually compare over, so the prior bucket is a
  // real prior period rather than whatever fell inside the newest 200 rows.
  const since = new Date(Date.now() - 2 * TOPIC_WINDOW_DAYS * DAY).toISOString();
  const items = await queryItems({ sortBy: "recent", publishedSince: since });
  const now = Date.now();
  const current = new Map<string, number>();
  const prior = new Map<string, number>();

  for (const item of items) {
    const topic = item.topic?.trim();
    if (!topic || MEGA_TOPICS.has(topic)) continue;

    const published = new Date(item.publishedAt).getTime();
    if (Number.isNaN(published)) continue;

    const age = now - published;
    const bucket =
      age <= TOPIC_WINDOW_DAYS * DAY
        ? current
        : age <= 2 * TOPIC_WINDOW_DAYS * DAY
        ? prior
        : null;
    if (!bucket) continue;

    bucket.set(topic, (bucket.get(topic) ?? 0) + 1);
  }

  const hasBaseline = Array.from(prior.values()).some((count) => count > 0);
  const maxCount = Math.max(1, ...current.values());

  const topics = Array.from(current.entries())
    .map(([topic, count]) => {
      const previous = prior.get(topic) ?? 0;
      const { delta, rising } = topicDelta(count, previous, hasBaseline);
      return { topic, count, previous, momentum: count / maxCount, delta, rising };
    })
    .filter((entry) => entry.count >= MIN_TOPIC_ITEMS)
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, MAX_RISING_TOPICS);

  return { topics, hasBaseline, windowDays: TOPIC_WINDOW_DAYS };
}

/**
 * Journal's `eventDelta`: no prior data means no delta, and a prior count below
 * `MIN_DELTA_BASE` is too small to express as a percentage honestly.
 */
function topicDelta(
  current: number,
  previous: number,
  hasBaseline: boolean
): { delta: string | null; rising: boolean } {
  if (!hasBaseline) return { delta: null, rising: false };
  if (previous === 0) return { delta: current > 0 ? "new" : null, rising: current > 0 };
  if (previous < MIN_DELTA_BASE) return { delta: null, rising: false };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { delta: "0%", rising: false };
  return { delta: `${pct > 0 ? "+" : ""}${pct}%`, rising: pct > 0 };
}

/**
 * Aggregates detected resources across every item, deduped by URL with a real
 * mention count - the shape journal's `resources` table carries.
 *
 * Nothing is synthesized from an item's own category: resources come only from
 * `detectResources`, which refuses to promote an item's own permalink unless it
 * is a genuinely named tool.
 */
