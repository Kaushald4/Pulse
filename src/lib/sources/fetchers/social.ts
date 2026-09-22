/**
 * The sites behind a login: Reddit, X, and LinkedIn. Each takes the browser
 * profile that is already signed in for it.
 */
import type { PulseItem, SourceOptions } from "../../types";
import { runHelmsman } from "../helmsman";
import { baseItem, text, toIso } from "../normalize";
import { count, list, one } from "../options";

/** One helmsman call per configured subreddit - each launches its own browser. */
export async function fetchReddit(profile: string, options: SourceOptions): Promise<PulseItem[]> {
  const subreddits = list(options.subreddits, ["localllama"], 12);
  const sort = one(options.sort, "hot");
  const limit = count(options.limit, 20, 1, 100);
  const collected: PulseItem[] = [];
  const errors: string[] = [];

  for (const subreddit of subreddits) {
    let posts: any[] = [];
    try {
      posts = await runHelmsman("reddit", [
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

  // Every attempt failing is a failure, not an empty result - otherwise a total
  // failure would be recorded as a clean sync.
  if (collected.length === 0 && errors.length === subreddits.length && errors.length > 0) {
    throw new Error(errors[0]);
  }

  return collected;
}

/** Home timeline, or one search per configured keyword. */
export async function fetchTwitter(profile: string, options: SourceOptions): Promise<PulseItem[]> {
  const limit = count(options.limit, 20, 1, 100);
  const mode = options.mode === "search" ? "search" : "feed";

  const batches: any[][] = [];
  if (mode === "search") {
    for (const query of list(options.queries, ["AI agents"], 5)) {
      batches.push(
        await runHelmsman("twitter", ["search", profile, query, "--sort", "top", "--limit", String(limit)])
      );
    }
  } else {
    batches.push(await runHelmsman("twitter", ["feed", profile, "--limit", String(limit)]));
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

export async function fetchLinkedIn(profile: string, options: SourceOptions): Promise<PulseItem[]> {
  const keywords = one(options.keywords, "AI Engineer");
  const limit = count(options.limit, 15);

  const args = ["jobs", profile, keywords, "--limit", String(limit)];
  const location = (options.location ?? "").trim();
  if (location) args.push("--location", location);

  const jobs = await runHelmsman("linkedin", args);

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
        title: company ? `${title} - ${company}` : title,
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
