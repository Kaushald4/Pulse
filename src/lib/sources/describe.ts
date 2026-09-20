/**
 * How a source describes itself in the UI: its one-line option summary, and the
 * domain it belongs to.
 */
import type { SourceConnection, SourceOptions } from "../types";
import { count, feedHost, list, one } from "./options";

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

/** The site a source reads from - the key two sources are grouped by. */
export function sourceDomain(source: SourceConnection): string {
  if (source.source === "rss") return feedHost(source.options?.feedUrl);
  const site = (source.siteDomain ?? "").replace(/^www\./, "").trim();
  return site || FALLBACK_DOMAINS[source.source] || source.source;
}
