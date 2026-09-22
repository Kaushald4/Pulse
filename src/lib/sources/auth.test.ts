import { describe, expect, it } from "vitest";
import type { SourceConnection } from "../types";
import { canSync, partitionSyncable, requiresProfile } from "./auth";

function source(overrides: Partial<SourceConnection> & Pick<SourceConnection, "source">): SourceConnection {
  return {
    id: overrides.source,
    name: overrides.source,
    authType: "public_api",
    isConnected: false,
    monitoredChannels: [],
    ...overrides,
  };
}

describe("requiresProfile", () => {
  it("is false for every public feed", () => {
    const publicFeeds = [
      "hackernews",
      "lobsters",
      "arxiv",
      "huggingface",
      "devto",
      "producthunt",
      "github",
      "rss",
    ];
    for (const id of publicFeeds) expect(requiresProfile(id)).toBe(false);
  });

  it("is true for the platforms that need a login", () => {
    for (const id of ["reddit", "twitter", "linkedin"]) expect(requiresProfile(id)).toBe(true);
  });
});

describe("canSync", () => {
  it("collects a public source with no profile at all", () => {
    expect(canSync(source({ source: "hackernews" }))).toBe(true);
  });

  it("attempts a platform source once a profile is saved, before any sync has succeeded", () => {
    // The regression this guards. Gating on isConnected made a first sync
    // impossible, because only a successful sync could ever set that flag.
    const reddit = source({
      source: "reddit",
      authType: "browser_profile",
      isConnected: false,
      profileExists: true,
    });
    expect(canSync(reddit)).toBe(true);
  });

  it("leaves a platform source alone when no profile has ever been saved", () => {
    const reddit = source({
      source: "reddit",
      authType: "browser_profile",
      profileExists: false,
    });
    expect(canSync(reddit)).toBe(false);
  });

  it("does not treat a proven connection as a substitute for a profile", () => {
    const reddit = source({ source: "reddit", authType: "browser_profile", isConnected: true });
    expect(canSync(reddit)).toBe(false);
  });
});

describe("partitionSyncable", () => {
  it("splits in order and puts every source in exactly one list", () => {
    const sources = [
      source({ source: "hackernews" }),
      source({ source: "reddit", authType: "browser_profile", profileExists: true }),
      source({ id: "reddit-b", source: "reddit", authType: "browser_profile", profileExists: false }),
      source({ source: "twitter", authType: "browser_profile", profileExists: true }),
    ];

    const { ready, skipped } = partitionSyncable(sources);

    expect(ready.map((entry) => entry.id)).toEqual(["hackernews", "reddit", "twitter"]);
    expect(skipped.map((entry) => entry.id)).toEqual(["reddit-b"]);
    expect(ready.length + skipped.length).toBe(sources.length);
  });

  it("returns both lists empty for no sources", () => {
    expect(partitionSyncable([])).toEqual({ ready: [], skipped: [] });
  });
});
