import { describe, expect, it } from "vitest";
import { groupItems, pickRepresentative, toGroup } from "./grouping";
import type { PulseItem } from "../types";

/** Only the fields grouping reads, so a fixture says what it is testing. */
function item(over: Partial<PulseItem> & { id: string; url: string }): PulseItem {
  return {
    source: "rss",
    sourceType: "feed",
    category: "news",
    field: "ai_ml",
    title: over.id,
    body: null,
    author: null,
    authorUrl: null,
    score: 0,
    commentsCount: 0,
    publishedAt: "2026-01-01T00:00:00.000Z",
    state: "inbox",
    tags: [],
    extractedResources: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    topic: null,
    ...over,
  } as PulseItem;
}

describe("groupItems", () => {
  it("collapses the same story from several sources into one group", () => {
    const groups = groupItems([
      item({ id: "hn-1", url: "https://example.com/post?utm_source=hn", source: "hackernews" }),
      item({ id: "rss-1", url: "https://www.example.com/post/", source: "rss" }),
      item({ id: "rd-1", url: "https://example.com/post#comments", source: "reddit" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toBe(3);
    expect(groups[0].sources).toEqual(["hackernews", "rss", "reddit"]);
  });

  it("keeps different stories apart", () => {
    const groups = groupItems([
      item({ id: "a", url: "https://example.com/one" }),
      item({ id: "b", url: "https://example.com/two" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("counts a source once however many of its items are in the group", () => {
    const groups = groupItems([
      item({ id: "a", url: "https://example.com/p", source: "rss" }),
      item({ id: "b", url: "https://example.com/p?ref=x", source: "rss" }),
    ]);
    expect(groups[0].members).toBe(2);
    expect(groups[0].sources).toEqual(["rss"]);
  });

  it("groups unreadable URLs by their own id rather than merging them", () => {
    const groups = groupItems([item({ id: "x", url: "" }), item({ id: "y", url: "not a url" })]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.key)).toEqual(["item:x", "item:y"]);
  });

  it("carries the group's best numbers, not the representative's", () => {
    const groups = groupItems([
      item({ id: "quiet", url: "https://example.com/p", score: 1, commentsCount: 0 }),
      item({ id: "loud", url: "https://example.com/p", score: 420, commentsCount: 99 }),
    ]);
    expect(groups[0].representative.id).toBe("loud");
    expect(groups[0].topScore).toBe(420);
    expect(groups[0].topComments).toBe(99);
  });
});

describe("pickRepresentative", () => {
  it("prefers the item whose own link this is", () => {
    const chosen = pickRepresentative([
      item({ id: "mentioned", url: "https://example.com/p", score: 900, primarySource: false }),
      item({ id: "itself", url: "https://example.com/p", score: 1, primarySource: true }),
    ]);
    expect(chosen.id).toBe("itself");
  });

  it("then prefers the highest score", () => {
    const chosen = pickRepresentative([
      item({ id: "low", url: "https://example.com/p", score: 10 }),
      item({ id: "high", url: "https://example.com/p", score: 50 }),
    ]);
    expect(chosen.id).toBe("high");
  });

  it("then the newest, and breaks remaining ties on id", () => {
    expect(
      pickRepresentative([
        item({ id: "old", url: "https://example.com/p", publishedAt: "2026-01-01T00:00:00.000Z" }),
        item({ id: "new", url: "https://example.com/p", publishedAt: "2026-02-01T00:00:00.000Z" }),
      ]).id
    ).toBe("new");

    expect(
      pickRepresentative([
        item({ id: "b", url: "https://example.com/p" }),
        item({ id: "a", url: "https://example.com/p" }),
      ]).id
    ).toBe("a");
  });
});

describe("toGroup", () => {
  it("builds a group of one for an item on its own", () => {
    const group = toGroup("https://example.com/p", [item({ id: "solo", url: "https://example.com/p" })]);
    expect(group.members).toBe(1);
    expect(group.sources).toEqual(["rss"]);
    expect(group.representative.id).toBe("solo");
  });
});
