import { describe, expect, it } from "vitest";
import { hashContent } from "../utils";
import type { PulseItem } from "../types";
import { needsClassification } from "./classification";

/**
 * The invalidation rule, tested away from the database. These cases are the
 * contract for "needs classifying": an item is re-labelled when its content
 * changed, and *not* re-labelled when nothing did, which is what keeps a sync
 * from paying to re-classify the whole library.
 */
function item(overrides: Partial<PulseItem> = {}): PulseItem {
  const base = {
    id: "hn-1",
    title: "A decision model",
    url: "https://example.com/a",
    body: "Body text",
  };
  return {
    ...base,
    source: "hackernews",
    sourceType: "api",
    category: "news",
    field: "developer_tools",
    score: 0,
    commentsCount: 0,
    publishedAt: "2026-09-01T00:00:00.000Z",
    state: "inbox",
    tags: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    classifiedAt: "2026-09-02T00:00:00.000Z",
    contentHash: hashContent(base.title, base.url, base.body),
    ...overrides,
  } as PulseItem;
}

describe("needsClassification", () => {
  it("is false for unchanged content that was already classified", () => {
    expect(needsClassification(item())).toBe(false);
  });

  it("is true when the title changed", () => {
    expect(needsClassification(item({ title: "A different headline" }))).toBe(true);
  });

  it("is true when the url changed", () => {
    expect(needsClassification(item({ url: "https://example.com/b" }))).toBe(true);
  });

  it("is true when the body changed", () => {
    expect(needsClassification(item({ body: "Different body text" }))).toBe(true);
  });

  it("is true when the body arrived where there was none before", () => {
    // The common real case: an item ingested as a link, whose body is filled in
    // later. The label was written from less evidence than exists now.
    const bare = item({
      body: null,
      contentHash: hashContent("A decision model", "https://example.com/a", null),
    });
    expect(needsClassification(bare)).toBe(false);
    expect(needsClassification({ ...bare, body: "Body text" })).toBe(true);
  });

  it("is true when there is no label at all", () => {
    expect(needsClassification(item({ classifiedAt: null }))).toBe(true);
  });

  it("is true when no hash was recorded, even with a label", () => {
    expect(needsClassification(item({ contentHash: null }))).toBe(true);
  });

  it("hashes exactly the three fields the classifier hashes", () => {
    // If finalize changed which fields it hashes, this rule would silently stop
    // matching and every item would look changed.
    const subject = item();
    expect(subject.contentHash).toBe(hashContent(subject.title, subject.url, subject.body));
  });
});
