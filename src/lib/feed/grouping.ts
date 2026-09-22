/**
 * One card per story.
 *
 * The same story arrives from several sources, so the feed groups items by
 * their canonical URL and shows the group as a single row, with the sources it
 * came from. A group of one is just an item.
 *
 * This is the in-memory half, used for the browser-preview storage path. The
 * SQLite path groups in SQL so it can page by group rather than by row, and
 * orders its members by the same rule as `pickRepresentative` below.
 */
import { groupKeyFor } from "./canonical";
import type { PulseItem } from "../types";

export interface FeedGroup {
  /** The canonical URL shared by every member, or the item's own id. */
  key: string;
  /** The item shown on the card. */
  representative: PulseItem;
  /** How many items this story arrived as. */
  members: number;
  /** Distinct sources, in the order they were first seen. */
  sources: string[];
  /** The group's best numbers, so the card carries the story's engagement. */
  topScore: number;
  topComments: number;
}

/**
 * Which member of a group stands for the story.
 *
 * The item whose own link this is beats one that merely mentioned it, then the
 * highest score, then the newest. Ties break on id so the choice is stable.
 */
export function pickRepresentative(items: PulseItem[]): PulseItem {
  return [...items].sort((a, b) => {
    const primary = Number(b.primarySource === true) - Number(a.primarySource === true);
    if (primary !== 0) return primary;
    if (b.score !== a.score) return b.score - a.score;
    const published = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    if (published !== 0) return published;
    return a.id.localeCompare(b.id);
  })[0];
}

/** Groups items by story, preserving the order the items arrived in. */
export function groupItems(items: PulseItem[]): FeedGroup[] {
  const groups = new Map<string, PulseItem[]>();

  for (const item of items) {
    const key = groupKeyFor(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  return Array.from(groups, ([key, members]) => toGroup(key, members));
}

/** Builds a group from the members that share a key. */
export function toGroup(key: string, members: PulseItem[]): FeedGroup {
  const sources: string[] = [];
  for (const member of members) {
    if (!sources.includes(member.source)) sources.push(member.source);
  }

  return groupFromAggregates({
    key,
    representative: pickRepresentative(members),
    members: members.length,
    sources,
    topScore: members.reduce((best, member) => Math.max(best, member.score ?? 0), 0),
    topComments: members.reduce((best, member) => Math.max(best, member.commentsCount ?? 0), 0),
  });
}

/**
 * A group from numbers rather than from members.
 *
 * The SQLite path never loads a group's members: it aggregates them, so this is
 * how its rows become the same shape the in-memory path produces.
 */
export function groupFromAggregates(input: {
  key: string;
  representative: PulseItem;
  members: number;
  sources: string[];
  topScore: number;
  topComments: number;
}): FeedGroup {
  return {
    key: input.key,
    representative: input.representative,
    members: input.members,
    sources: input.sources,
    topScore: input.topScore,
    topComments: input.topComments,
  };
}
