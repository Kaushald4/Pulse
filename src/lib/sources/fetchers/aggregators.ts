/**
 * Link aggregators and feeds: Hacker News, Lobsters, and plain RSS/Atom.
 */
import type { PulseItem, SourceOptions } from "../../types";
import { invoke, runHelmsman } from "../helmsman";
import { baseItem, text, toIso } from "../normalize";
import { count, list, one } from "../options";

export async function fetchHackerNews(options: SourceOptions): Promise<PulseItem[]> {
  if (options.mode === "search") return fetchHackerNewsSearch(options);

  const limit = count(options.limit, 25);
  const stories = await runHelmsman("hackernews", ["feed", "--limit", String(limit)]);

  return stories
    .map((story) => {
      const title = text(story.title);
      const url = text(story.externalUrl) || text(story.itemUrl);
      if (!title || !url) return null;
      return baseItem({
        id: `hn-${text(story.id) || url}`,
        source: "hackernews",
        sourceType: "hackernews_story",
        title,
        url,
        author: text(story.author) || null,
        authorUrl: story.author ? `https://news.ycombinator.com/user?id=${text(story.author)}` : null,
        score: Number(story.points) || 0,
        commentsCount: Number(story.commentCount) || 0,
        publishedAt: toIso(story.publishedAt),
        tags: text(story.site) ? [text(story.site)] : [],
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

/** Keyword search - Algolia via helmsman, one call per query, no browser. */
export async function fetchHackerNewsSearch(options: SourceOptions): Promise<PulseItem[]> {
  const limit = count(options.limit, 20, 1, 50);
  const seen = new Set<string>();
  const items: PulseItem[] = [];

  for (const query of list(options.queries, ["AI agents"], 12)) {
    const stories = await runHelmsman("hackernews", [
      "search",
      query,
      "--sort",
      "date",
      "--limit",
      String(limit),
    ]);

    for (const story of stories) {
      const title = text(story.title);
      const url = text(story.externalUrl) || text(story.itemUrl);
      const id = `hn-${text(story.id) || url}`;
      if (!title || !url || seen.has(id)) continue;
      seen.add(id);
      items.push(
        baseItem({
          id,
          source: "hackernews",
          sourceType: "hackernews_story",
          title,
          url,
          author: text(story.author) || null,
          authorUrl: story.author
            ? `https://news.ycombinator.com/user?id=${text(story.author)}`
            : null,
          score: Number(story.points) || 0,
          commentsCount: Number(story.commentCount) || 0,
          publishedAt: toIso(story.publishedAt),
          tags: text(story.site) ? [text(story.site)] : [],
        })
      );
    }
  }

  return items;
}

export async function fetchLobsters(options: SourceOptions): Promise<PulseItem[]> {
  const sort = one(options.sort, "hottest");
  const limit = count(options.limit, 25);
  const stories = await runHelmsman("lobsters", ["feed", "--sort", sort, "--limit", String(limit)]);

  return stories
    .map((story) => {
      const title = text(story.title);
      const url = text(story.url);
      if (!title || !url) return null;
      return baseItem({
        id: `lobsters-${text(story.id) || url}`,
        source: "lobsters",
        sourceType: "lobsters_story",
        title,
        url,
        body: text(story.body) || null,
        author: text(story.author) || null,
        authorUrl: text(story.authorUrl) || null,
        score: Number(story.score) || 0,
        commentsCount: Number(story.commentCount) || 0,
        publishedAt: toIso(story.publishedAt),
        tags: Array.isArray(story.tags) ? story.tags.map(text).filter(Boolean) : [],
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

/** An RSS/Atom entry as returned by the Rust `fetch_feed` command. */
interface FeedEntry {
  id: string;
  title: string;
  url: string;
  summary?: string | null;
  author?: string | null;
  publishedAt?: string | null;
}

/**
 * A plain RSS/Atom feed - no browser, no login. The renderer cannot fetch
 * another origin (CORS), so the request and parsing happen in Rust.
 */
export async function fetchRss(sourceId: string, options: SourceOptions): Promise<PulseItem[]> {
  const feedUrl = (options.feedUrl ?? "").trim();
  if (!feedUrl) throw new Error("No feed URL is set for this source.");
  const limit = count(options.limit, 15, 1, 50);

  const entries = await invoke<FeedEntry[]>("fetch_feed", { url: feedUrl, limit });

  return entries
    .map((entry) => {
      const title = text(entry.title);
      const url = text(entry.url);
      if (!title || !url) return null;
      return baseItem({
        id: `rss-${sourceId}-${text(entry.id) || url}`,
        source: sourceId,
        sourceType: "rss_entry",
        title,
        url,
        body: text(entry.summary) || null,
        author: text(entry.author) || null,
        publishedAt: toIso(entry.publishedAt),
      });
    })
    .filter((item): item is PulseItem => item !== null);
}
