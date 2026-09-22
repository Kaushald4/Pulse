/**
 * Turning the feed's groups into sections.
 *
 * The list used to be one undifferentiated column. Two things are worth pulling
 * out of it, and only when they have something in them: what arrived since the
 * reader last looked, and what their own watchlists caught. Everything else
 * follows in the order the sort asked for.
 *
 * A story appears in exactly one section, so a capped section never repeats
 * itself further down.
 */
import { matchedWatchlists } from "./ranking";
import type { FeedGroup } from "./grouping";
import type { Watchlist } from "../types";

export type FeedSectionId = "new" | "watchlists" | "rest";

export interface FeedSection {
  id: FeedSectionId;
  /** Empty for a lone section: a heading needs something to head. */
  title: string;
  groups: FeedGroup[];
}

/** How many groups a pulled-out section may show before the rest take over. */
const SECTION_LIMIT = 8;

export function buildSections(input: {
  groups: FeedGroup[];
  lastSeenAt: string | null;
  watchlists: Watchlist[];
  limit?: number;
}): FeedSection[] {
  const { groups, lastSeenAt, watchlists, limit = SECTION_LIMIT } = input;
  const taken = new Set<string>();

  const claim = (candidates: FeedGroup[]): FeedGroup[] => {
    const claimed: FeedGroup[] = [];
    for (const group of candidates) {
      if (claimed.length === limit) break;
      if (taken.has(group.key)) continue;
      taken.add(group.key);
      claimed.push(group);
    }
    return claimed;
  };

  const sections: FeedSection[] = [];

  // Collection time, not publication time: a paper published last week but
  // collected this morning is still new to the reader.
  if (lastSeenAt) {
    const since = new Date(lastSeenAt).getTime();
    const fresh = claim(groups.filter((group) => new Date(group.latestCollectedAt).getTime() > since));
    if (fresh.length > 0) {
      sections.push({ id: "new", title: "New since you last looked", groups: fresh });
    }
  }

  if (watchlists.some((watchlist) => watchlist.enabled)) {
    const caught = claim(
      groups.filter((group) => matchedWatchlists(group.representative, watchlists).length > 0)
    );
    if (caught.length > 0) {
      sections.push({ id: "watchlists", title: "From your watchlists", groups: caught });
    }
  }

  const rest = groups.filter((group) => !taken.has(group.key));
  if (rest.length > 0) {
    sections.push({
      id: "rest",
      title: sections.length > 0 ? "Everything else" : "",
      groups: rest,
    });
  }

  return sections;
}
