/**
 * Grouping the source list by domain, and the filter chips shown for each one.
 */
import type { SourceConnection, SourceOptions } from "../types";
import { sourceDomain } from "./describe";
import { count, feedHost, list, one } from "./options";

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
 * Every filter/category a source applies by default, as display chips - what
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
