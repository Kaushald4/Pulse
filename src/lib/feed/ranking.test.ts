import { describe, expect, it } from "vitest";
import { byImportance, diversify, diversifyHead } from "./ranking";
import type { FeedGroup } from "./grouping";
import type { PulseItem } from "../types";

/** Only what the ranking reads. A cast keeps the fixture honest about that. */
const group = (key: string, source: string): FeedGroup => ({
  key,
  representative: { source } as PulseItem,
  members: 1,
  sources: [source],
  latestAt: "2026-01-01T00:00:00.000Z",
  latestCollectedAt: "2026-01-01T00:00:00.000Z",
  topScore: 0,
  topComments: 0,
});

describe("diversify", () => {
  const options = {
    sourceOf: (entry: { source: string }) => entry.source,
    keyOf: (entry: { key: string }) => entry.key,
    limit: 4,
  };

  it("defers a source that has had its turn", () => {
    const ranked = [
      { key: "a1", source: "a" },
      { key: "a2", source: "a" },
      { key: "a3", source: "a" },
      { key: "a4", source: "a" },
      { key: "b1", source: "b" },
    ];

    // Four slots, but no source may take more than three.
    expect(diversify(ranked, { ...options, limit: 4 }).map((entry) => entry.key)).toEqual([
      "a1",
      "a2",
      "a3",
      "b1",
    ]);
  });

  it("tops up in rank order when there is nothing else to take", () => {
    const ranked = [
      { key: "a1", source: "a" },
      { key: "a2", source: "a" },
      { key: "a3", source: "a" },
      { key: "a4", source: "a" },
    ];

    // The cap cannot be honoured without leaving a slot empty, so it yields.
    expect(diversify(ranked, options).map((entry) => entry.key)).toEqual(["a1", "a2", "a3", "a4"]);
  });
});

describe("diversifyHead", () => {
  const ranked = [
    ...Array.from({ length: 5 }, (_, index) => group(`a${index}`, "a")),
    ...Array.from({ length: 5 }, (_, index) => group(`b${index}`, "b")),
  ];

  it("spreads the head across sources and keeps the rest in rank order", () => {
    const arranged = diversifyHead(ranked, 6);

    expect(arranged).toHaveLength(ranked.length);
    expect(arranged.slice(0, 6).map((entry) => entry.key)).toEqual(["a0", "a1", "a2", "b0", "b1", "b2"]);
    // Everything is still present, once, and the tail keeps its order.
    expect(new Set(arranged.map((entry) => entry.key)).size).toBe(ranked.length);
    expect(arranged.slice(6).map((entry) => entry.key)).toEqual(["a3", "a4", "b3", "b4"]);
  });

  it("leaves a short list alone", () => {
    const short = [group("a0", "a"), group("a1", "a")];
    expect(diversifyHead(short, 6)).toEqual(short);
  });
});

describe("byImportance", () => {
  it("puts a classified item above an unclassified one", () => {
    const scored = { signal: 0.1, score: 0, commentsCount: 0 } as PulseItem;
    const unscored = { signal: null, score: 9999, commentsCount: 9999 } as PulseItem;
    expect(byImportance(scored, unscored)).toBeLessThan(0);
  });

  it("then ranks by score, and falls back to engagement", () => {
    const high = { signal: 0.9, score: 0, commentsCount: 0 } as PulseItem;
    const low = { signal: 0.2, score: 0, commentsCount: 0 } as PulseItem;
    expect(byImportance(high, low)).toBeLessThan(0);

    const discussed = { signal: null, score: 10, commentsCount: 40 } as PulseItem;
    const voted = { signal: null, score: 70, commentsCount: 0 } as PulseItem;
    // 10 + 40*2 beats 70, because comments weigh double.
    expect(byImportance(discussed, voted)).toBeLessThan(0);
  });
});
