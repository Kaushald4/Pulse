import { describe, expect, it } from "vitest";
import { buildSections } from "./sections";
import type { FeedGroup } from "./grouping";
import type { PulseItem, Watchlist } from "../types";

/** Only what the sections read: collected time, key, and title for matching. */
const group = (key: string, collectedAt: string, title = key): FeedGroup => ({
  key,
  representative: { id: key, title, body: null, topic: null, tags: [] } as unknown as PulseItem,
  members: 1,
  sources: ["rss"],
  latestAt: collectedAt,
  latestCollectedAt: collectedAt,
  topScore: 0,
  topComments: 0,
});

const watchlist = (name: string, query: string, enabled = true): Watchlist => ({
  id: name,
  name,
  query,
  enabled,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const keys = (section: { groups: FeedGroup[] }) => section.groups.map((entry) => entry.key);

describe("buildSections", () => {
  const groups = [
    group("a", "2026-06-10T10:00:00.000Z", "Rust news"),
    group("b", "2026-06-09T10:00:00.000Z", "Something else"),
    group("c", "2026-06-08T10:00:00.000Z", "More Rust"),
  ];

  it("pulls out what arrived since the reader last looked", () => {
    const sections = buildSections({
      groups,
      lastSeenAt: "2026-06-09T12:00:00.000Z",
      watchlists: [],
    });

    expect(sections.map((section) => section.id)).toEqual(["new", "rest"]);
    expect(keys(sections[0])).toEqual(["a"]);
    expect(keys(sections[1])).toEqual(["b", "c"]);
  });

  it("pulls out what the watchlists caught, and never twice", () => {
    const sections = buildSections({
      groups,
      lastSeenAt: null,
      watchlists: [watchlist("rust", "rust")],
    });

    expect(sections.map((section) => section.id)).toEqual(["watchlists", "rest"]);
    expect(keys(sections[0])).toEqual(["a", "c"]);
    expect(keys(sections[1])).toEqual(["b"]);
  });

  it("keeps a story in one section when both would claim it", () => {
    const sections = buildSections({
      groups,
      lastSeenAt: "2026-06-09T12:00:00.000Z",
      watchlists: [watchlist("rust", "rust")],
    });

    expect(sections.map((section) => section.id)).toEqual(["new", "watchlists", "rest"]);
    // "a" is new, so the watchlist section takes the other match rather than
    // repeating it.
    expect(keys(sections[0])).toEqual(["a"]);
    expect(keys(sections[1])).toEqual(["c"]);
    expect(keys(sections[2])).toEqual(["b"]);
  });

  it("caps a pulled-out section and leaves the rest in the list", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      group(`g${index}`, "2026-06-10T10:00:00.000Z", "Rust")
    );
    const sections = buildSections({
      groups: many,
      lastSeenAt: null,
      watchlists: [watchlist("rust", "rust")],
      limit: 3,
    });

    expect(keys(sections[0])).toEqual(["g0", "g1", "g2"]);
    // Everything is still present, once.
    const all = sections.flatMap(keys);
    expect(all).toHaveLength(many.length);
    expect(new Set(all).size).toBe(many.length);
  });

  it("renders one untitled section when there is nothing to pull out", () => {
    const sections = buildSections({ groups, lastSeenAt: null, watchlists: [] });

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("");
    expect(keys(sections[0])).toEqual(["a", "b", "c"]);
  });

  it("ignores a disabled watchlist, and a first visit with no marker", () => {
    const sections = buildSections({
      groups,
      lastSeenAt: null,
      watchlists: [watchlist("rust", "rust", false)],
    });

    expect(sections.map((section) => section.id)).toEqual(["rest"]);
  });

  it("has no sections when there is nothing to show", () => {
    expect(buildSections({ groups: [], lastSeenAt: "2026-06-09T12:00:00.000Z", watchlists: [] })).toEqual([]);
  });
});
