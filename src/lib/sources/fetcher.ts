import type { PulseItem, SourceConnection, SourceOptions } from "../types";
import { heuristicClassify } from "../classify/heuristic";
import { isTauriEnv } from "../config";

/* -------------------------------------------------------------------------- */
/* Tauri bridge                                                                */
/* -------------------------------------------------------------------------- */

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import("@tauri-apps/api/core");
  return call<T>(command, args);
}

function requireDesktop(): void {
  if (!isTauriEnv()) {
    throw new Error("Sync requires the desktop app. Run `pnpm tauri dev` instead of the browser preview.");
  }
}

async function helmsman(command: string, args: string[]): Promise<any[]> {
  const result = await invoke<unknown>("run_helmsman_extract", { command, args });
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") return [result];
  return [];
}

/** Whether the Chrome profile directory exists. NOT proof that a login happened. */
export async function profileExists(profileName: string): Promise<boolean> {
  if (!isTauriEnv()) return false;
  try {
    return await invoke<boolean>("check_profile_status", { profile: profileName });
  } catch {
    return false;
  }
}

export async function launchAuthLogin(profileName: string, siteDomain: string): Promise<string> {
  if (!isTauriEnv()) {
    window.open(`https://${siteDomain}`, "_blank");
    return `Opened https://${siteDomain} in the browser.`;
  }
  return invoke<string>("launch_auth_login", { profile: profileName, site: siteDomain });
}

/** Deletes the saved Chrome profile for a source, signing it out for real. */
export async function disconnectProfile(
  profileName: string
): Promise<{ removed: boolean; path: string }> {
  if (!isTauriEnv()) {
    throw new Error("Disconnecting requires the desktop app.");
  }
  return invoke<{ removed: boolean; path: string }>("disconnect_profile", { profile: profileName });
}

/* -------------------------------------------------------------------------- */
/* Option helpers                                                              */
/* -------------------------------------------------------------------------- */

function list(value: string[] | undefined, fallback: string[], max = 5): string[] {
  const cleaned = (value ?? []).map((entry) => entry.trim()).filter(Boolean);
  return (cleaned.length > 0 ? cleaned : fallback).slice(0, max);
}

function one(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

function count(value: number | undefined, fallback: number, min = 1, max = 50): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

/** Display name for a feed URL: its host, without `www`. */
function feedHost(feedUrl?: string): string {
  const value = (feedUrl ?? "").trim();
  if (!value) return "no feed URL";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

/* -------------------------------------------------------------------------- */
/* Mapping helpers                                                             */
/* -------------------------------------------------------------------------- */

function toIso(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function joinNames(value: unknown): string {
  return Array.isArray(value) ? value.map(text).filter(Boolean).join(", ") : text(value);
}

interface BaseInput {
  id: string;
  source: string;
  sourceType: string;
  title: string;
  url: string;
  body?: string | null;
  author?: string | null;
  authorUrl?: string | null;
  score?: number;
  commentsCount?: number;
  publishedAt?: string;
  tags?: string[];
}

function baseItem(input: BaseInput): PulseItem {
  const heuristic = heuristicClassify({
    title: input.title,
    body: input.body ?? null,
    url: input.url,
    source: input.source,
  });

  return {
    id: input.id,
    source: input.source,
    sourceType: input.sourceType,
    category: heuristic.category,
    field: heuristic.field,
    title: input.title,
    url: input.url,
    body: input.body ?? null,
    author: input.author ?? null,
    authorUrl: input.authorUrl ?? null,
    score: input.score ?? 0,
    commentsCount: input.commentsCount ?? 0,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    state: "inbox",
    tags: Array.from(new Set([...(input.tags ?? []), ...heuristic.tags])),
    extractedResources: heuristic.extractedResources,
    createdAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Per-source fetchers                                                         */
/* -------------------------------------------------------------------------- */

async function fetchHackerNews(options: SourceOptions): Promise<PulseItem[]> {
  if (options.mode === "search") return fetchHackerNewsSearch(options);

  const limit = count(options.limit, 25);
  const stories = await helmsman("hackernews", ["feed", "--limit", String(limit)]);

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

/** Keyword search — Algolia via helmsman, one call per query, no browser. */
async function fetchHackerNewsSearch(options: SourceOptions): Promise<PulseItem[]> {
  const limit = count(options.limit, 20, 1, 50);
  const seen = new Set<string>();
  const items: PulseItem[] = [];

  for (const query of list(options.queries, ["AI agents"], 12)) {
    const stories = await helmsman("hackernews", [
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

async function fetchLobsters(options: SourceOptions): Promise<PulseItem[]> {
  const sort = one(options.sort, "hottest");
  const limit = count(options.limit, 25);
  const stories = await helmsman("lobsters", ["feed", "--sort", sort, "--limit", String(limit)]);

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

async function fetchArxiv(options: SourceOptions): Promise<PulseItem[]> {
  const category = one(options.category, "cs.AI");
  const limit = count(options.limit, 15);
  const papers = await helmsman("arxiv", [
    "papers",
    "--category",
    category,
    "--limit",
    String(limit),
  ]);

  return papers
    .map((paper) => {
      const title = text(paper.title);
      const url = text(paper.url);
      if (!title || !url) return null;
      const authors = joinNames(paper.authors);
      return baseItem({
        id: `arxiv-${text(paper.id) || url}`,
        source: "arxiv",
        sourceType: "arxiv_paper",
        title,
        url,
        body: text(paper.summary) || null,
        author: authors || "arXiv",
        authorUrl: "https://arxiv.org",
        publishedAt: toIso(paper.publishedAt),
        tags: text(paper.category) ? [text(paper.category)] : [],
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

async function fetchHuggingFace(options: SourceOptions): Promise<PulseItem[]> {
  const limit = count(options.limit, 15);
  const papers = await helmsman("huggingface", ["papers", "--limit", String(limit)]);

  return papers
    .map((paper) => {
      const title = text(paper.title);
      const url = text(paper.url);
      if (!title || !url) return null;
      return baseItem({
        id: `hf-${text(paper.id) || url}`,
        source: "huggingface",
        sourceType: "huggingface_paper",
        title,
        url,
        body: text(paper.summary) || null,
        author: joinNames(paper.authors) || "Hugging Face",
        authorUrl: "https://huggingface.co/papers",
        score: Number(paper.upvotes) || 0,
        commentsCount: Number(paper.commentCount) || 0,
        publishedAt: toIso(paper.publishedAt),
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

async function fetchDevTo(options: SourceOptions): Promise<PulseItem[]> {
  const tag = one(options.tag, "ai");
  const limit = count(options.limit, 15);
  const articles = await helmsman("devto", [
    "articles",
    "--tag",
    tag,
    "--top",
    "7",
    "--limit",
    String(limit),
  ]);

  return articles
    .map((article) => {
      const title = text(article.title);
      const url = text(article.url);
      if (!title || !url) return null;
      return baseItem({
        id: `devto-${text(article.id) || url}`,
        source: "devto",
        sourceType: "devto_article",
        title,
        url,
        body: text(article.description) || null,
        author: text(article.author) || null,
        authorUrl: text(article.authorUrl) || null,
        score: Number(article.reactionsCount) || 0,
        commentsCount: Number(article.commentsCount) || 0,
        publishedAt: toIso(article.publishedAt),
        tags: Array.isArray(article.tags) ? article.tags.map(text).filter(Boolean) : [],
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

async function fetchProductHunt(options: SourceOptions): Promise<PulseItem[]> {
  const limit = count(options.limit, 15);
  const posts = await helmsman("producthunt", ["feed", "--limit", String(limit)]);

  return posts
    .map((post) => {
      const title = text(post.name);
      const url = text(post.url) || text(post.website);
      if (!title || !url) return null;
      return baseItem({
        id: `ph-${text(post.id) || url}`,
        source: "producthunt",
        sourceType: "producthunt_post",
        title,
        url,
        body: text(post.tagline) || null,
        score: Number(post.votesCount) || 0,
        commentsCount: Number(post.commentsCount) || 0,
        publishedAt: toIso(post.createdAt),
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

/** One helmsman call per configured subreddit — each launches its own browser. */
async function fetchReddit(profile: string, options: SourceOptions): Promise<PulseItem[]> {
  const subreddits = list(options.subreddits, ["localllama"], 12);
  const sort = one(options.sort, "hot");
  const limit = count(options.limit, 20, 1, 100);
  const collected: PulseItem[] = [];
  const errors: string[] = [];

  for (const subreddit of subreddits) {
    let posts: any[] = [];
    try {
      posts = await helmsman("reddit", [
        "feed",
        profile,
        "--subreddit",
        subreddit.replace(/^\/?r\//, ""),
        "--sort",
        sort,
        "--limit",
        String(limit),
      ]);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    for (const post of posts) {
      const title = text(post.title);
      const url = text(post.postUrl) || text(post.permalink);
      if (!title || !url) continue;
      const author = text(post.author);
      collected.push(
        baseItem({
          id: `reddit-${text(post.id) || url}`,
          source: "reddit",
          sourceType: "reddit_post",
          title,
          url,
          author: author || null,
          authorUrl: author ? `https://www.reddit.com/user/${author}` : null,
          score: Number(post.score) || 0,
          commentsCount: Number(post.commentCount) || 0,
          publishedAt: toIso(post.createdAt),
          tags: [text(post.subreddit) || subreddit],
        })
      );
    }
  }

  // Every attempt failing is a failure, not an empty result — otherwise a total
  // failure would be recorded as a clean sync.
  if (collected.length === 0 && errors.length === subreddits.length && errors.length > 0) {
    throw new Error(errors[0]);
  }

  return collected;
}

/** Home timeline, or one search per configured keyword. */
async function fetchTwitter(profile: string, options: SourceOptions): Promise<PulseItem[]> {
  const limit = count(options.limit, 20, 1, 100);
  const mode = options.mode === "search" ? "search" : "feed";

  const batches: any[][] = [];
  if (mode === "search") {
    for (const query of list(options.queries, ["AI agents"], 5)) {
      batches.push(await helmsman("twitter", ["search", profile, query, "--sort", "top", "--limit", String(limit)]));
    }
  } else {
    batches.push(await helmsman("twitter", ["feed", profile, "--limit", String(limit)]));
  }

  const seen = new Set<string>();
  const items: PulseItem[] = [];

  for (const tweets of batches) {
    for (const tweet of tweets) {
      const body = text(tweet.text);
      const url = text(tweet.statusUrl);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const handle = text(tweet.handle);
      items.push(
        baseItem({
          id: `twitter-${url}`,
          source: "twitter",
          sourceType: "twitter_tweet",
          title: body ? body.slice(0, 140) : `Tweet by @${handle || "unknown"}`,
          url,
          body: body || null,
          author: text(tweet.authorName) || handle || null,
          authorUrl: handle ? `https://x.com/${handle}` : null,
          score: Number(tweet.likes) || 0,
          commentsCount: Number(tweet.replies) || 0,
          publishedAt: toIso(tweet.publishedAt),
        })
      );
    }
  }

  return items;
}

async function fetchLinkedIn(profile: string, options: SourceOptions): Promise<PulseItem[]> {
  const keywords = one(options.keywords, "AI Engineer");
  const limit = count(options.limit, 15);

  const args = ["jobs", profile, keywords, "--limit", String(limit)];
  const location = (options.location ?? "").trim();
  if (location) args.push("--location", location);

  const jobs = await helmsman("linkedin", args);

  return jobs
    .map((job) => {
      const title = text(job.title);
      const url = text(job.jobUrl);
      if (!title || !url) return null;
      const company = text(job.company);
      const jobLocation = text(job.location);
      return baseItem({
        id: `linkedin-${url}`,
        source: "linkedin",
        sourceType: "linkedin_job",
        title: company ? `${title} — ${company}` : title,
        url,
        body: jobLocation
          ? `Location: ${jobLocation}${text(job.workplaceType) ? ` (${text(job.workplaceType)})` : ""}`
          : null,
        author: company || null,
        tags: Array.isArray(job.badges) ? job.badges.map(text).filter(Boolean) : [],
        publishedAt: toIso(job.postedAt),
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

async function fetchGithub(options: SourceOptions): Promise<PulseItem[]> {
  const days = count(options.days, 7, 1, 90);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const language = (options.language ?? "").trim() || null;
  const limit = count(options.limit, 25);

  const repos = await invoke<
    Array<{
      id: string;
      name: string;
      url: string;
      description: string | null;
      author: string;
      stars: number;
      language: string | null;
      createdAt: string;
    }>
  >("github_trending", { since, language, limit });

  return repos.map((repo) =>
    baseItem({
      id: `github-${repo.id}`,
      source: "github",
      sourceType: "github_repo",
      title: repo.name,
      url: repo.url,
      body: repo.description,
      author: repo.author,
      authorUrl: `https://github.com/${repo.author}`,
      score: repo.stars,
      publishedAt: toIso(repo.createdAt),
      tags: repo.language ? [repo.language] : [],
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

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
 * A plain RSS/Atom feed — no browser, no login. The renderer cannot fetch
 * another origin (CORS), so the request and parsing happen in Rust.
 */
async function fetchRss(sourceId: string, options: SourceOptions): Promise<PulseItem[]> {
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

/** Sources that need no login; the profile argument is ignored for them. */
const PUBLIC_SOURCES = new Set([
  "hackernews",
  "lobsters",
  "arxiv",
  "huggingface",
  "devto",
  "producthunt",
  "github",
  "rss",
]);

export function requiresProfile(sourceId: string): boolean {
  return !PUBLIC_SOURCES.has(sourceId);
}

export async function fetchSource(source: SourceConnection): Promise<PulseItem[]> {
  requireDesktop();

  const profile = source.profileName?.trim() || "default";
  const options: SourceOptions = source.options ?? {};

  switch (source.source) {
    case "hackernews":
      return fetchHackerNews(options);
    case "lobsters":
      return fetchLobsters(options);
    case "arxiv":
      return fetchArxiv(options);
    case "huggingface":
      return fetchHuggingFace(options);
    case "devto":
      return fetchDevTo(options);
    case "producthunt":
      return fetchProductHunt(options);
    case "github":
      return fetchGithub(options);
    case "rss":
      return fetchRss(source.source, options);
    case "reddit":
      return fetchReddit(profile, options);
    case "twitter":
      return fetchTwitter(profile, options);
    case "linkedin":
      return fetchLinkedIn(profile, options);
    default:
      throw new Error(`No extractor implemented for source "${source.source}".`);
  }
}

/** Compact summary of a source's settings, for display on its card. */
export function describeOptions(source: SourceConnection): string[] {
  const options = source.options ?? {};
  switch (source.source) {
    case "rss":
      return [feedHost(options.feedUrl)];
    case "hackernews":
      return options.mode === "search"
        ? list(options.queries, ["AI agents"], 12).map((query) => `“${query}”`)
        : ["Front page"];
    case "reddit":
      return list(options.subreddits, ["localllama"], 12).map((sub) => `r/${sub.replace(/^\/?r\//, "")}`);
    case "twitter":
      return options.mode === "search"
        ? list(options.queries, ["AI agents"], 3).map((query) => `“${query}”`)
        : ["home timeline"];
    case "linkedin":
      return [one(options.keywords, "AI Engineer"), (options.location ?? "").trim()].filter(Boolean);
    case "arxiv":
      return [one(options.category, "cs.AI")];
    case "devto":
      return [`#${one(options.tag, "ai")}`];
    case "lobsters":
      return [one(options.sort, "hottest")];
    case "github":
      return [
        (options.language ?? "").trim() ? `${options.language}` : "all languages",
        `last ${count(options.days, 7, 1, 90)}d`,
      ];
    default:
      return source.monitoredChannels;
  }
}

/* -------------------------------------------------------------------------- */
/* Grouping + applied defaults                                                 */
/* -------------------------------------------------------------------------- */

const FALLBACK_DOMAINS: Record<string, string> = {
  reddit: "reddit.com",
  twitter: "x.com",
  linkedin: "linkedin.com",
  hackernews: "news.ycombinator.com",
  github: "github.com",
  huggingface: "huggingface.co",
  arxiv: "arxiv.org",
  lobsters: "lobste.rs",
  devto: "dev.to",
  producthunt: "producthunt.com",
};

/** The site a source reads from — the key two sources are grouped by. */
export function sourceDomain(source: SourceConnection): string {
  if (source.source === "rss") return feedHost(source.options?.feedUrl);
  const site = (source.siteDomain ?? "").replace(/^www\./, "").trim();
  return site || FALLBACK_DOMAINS[source.source] || source.source;
}

function defaultLimit(source: string, options: SourceOptions): number {
  switch (source) {
    case "hackernews":
      return options.mode === "search" ? 20 : 25;
    case "github":
    case "lobsters":
      return 25;
    case "reddit":
    case "twitter":
      return 20;
    default:
      return 15;
  }
}

/**
 * Every filter/category a source applies by default, as display chips — what
 * the source actually collects, rather than its raw option fields.
 */
export function sourceFilterChips(source: SourceConnection): string[] {
  const options = source.options ?? {};
  const chips: string[] = [];

  switch (source.source) {
    case "rss":
      chips.push(feedHost(options.feedUrl));
      break;
    case "hackernews":
      chips.push(options.mode === "search" ? "Keyword search" : "Front page");
      if (options.mode === "search") {
        chips.push(...list(options.queries, ["AI agents"], 12).map((query) => `“${query}”`));
      }
      break;
    case "reddit":
      chips.push(
        ...list(options.subreddits, ["localllama"], 12).map((sub) => `r/${sub.replace(/^\/?r\//, "")}`)
      );
      chips.push(`sort: ${one(options.sort, "hot")}`);
      break;
    case "twitter":
      chips.push(options.mode === "search" ? "Keyword search" : "Home timeline");
      if (options.mode === "search") {
        chips.push(...list(options.queries, ["AI agents"], 5).map((query) => `“${query}”`));
      }
      break;
    case "linkedin":
      chips.push(one(options.keywords, "AI Engineer"));
      if ((options.location ?? "").trim()) chips.push((options.location ?? "").trim());
      break;
    case "arxiv":
      chips.push(one(options.category, "cs.AI"));
      break;
    case "devto":
      chips.push(`#${one(options.tag, "ai")}`);
      break;
    case "lobsters":
      chips.push(one(options.sort, "hottest"));
      break;
    case "github":
      chips.push((options.language ?? "").trim() || "all languages");
      chips.push(`last ${count(options.days, 7, 1, 90)} days`);
      break;
    default:
      break;
  }

  chips.push(`${count(options.limit, defaultLimit(source.source, options))} per sync`);
  return chips;
}

export interface SourceGroup {
  domain: string;
  label: string;
  sources: SourceConnection[];
}

/**
 * The shared leading words of a group's names: "arXiv cs.AI" + "arXiv cs.CL"
 * → "arXiv"; "Hacker News" + "Hacker News Search" → "Hacker News".
 */
function commonLabel(sources: SourceConnection[]): string {
  if (sources.length === 1) return sources[0].name;

  const words = sources.map((source) => source.name.split(/\s+/));
  let end = words[0].length;
  for (const candidate of words.slice(1)) {
    let index = 0;
    while (
      index < end &&
      index < candidate.length &&
      candidate[index].toLowerCase() === words[0][index].toLowerCase()
    ) {
      index += 1;
    }
    end = index;
  }

  const shared = words[0].slice(0, end).join(" ").trim();
  return shared || sourceDomain(sources[0]);
}

/** Collapses sources that read from the same domain into one group. */
export function groupSourcesByDomain(sources: SourceConnection[]): SourceGroup[] {
  const byDomain = new Map<string, SourceConnection[]>();

  for (const source of sources) {
    const key = sourceDomain(source).toLowerCase();
    const existing = byDomain.get(key);
    if (existing) existing.push(source);
    else byDomain.set(key, [source]);
  }

  return Array.from(byDomain.values()).map((group) => ({
    domain: sourceDomain(group[0]),
    label: commonLabel(group),
    sources: group,
  }));
}
