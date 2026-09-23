import { describe, expect, it } from "vitest";
import { CANONICAL_EXCERPT_CHARS, CANONICAL_INPUT_VERSION, canonicalInputText } from "./canonical";

const item = {
  title: "A 0.6B decision model",
  source: "hackernews",
  url: "https://example.com/decision",
  author: "someone",
  body: "Body text about typed decisions.",
};

describe("canonicalInputText", () => {
  it("produces the exact layout the training dataset stores", () => {
    // Golden fixture: the dataset export reuses this function, so any change to
    // this string is a change to every exported training example.
    expect(canonicalInputText(item)).toBe(
      [
        "title: A 0.6B decision model",
        "source: hackernews",
        "author: someone",
        "url: https://example.com/decision",
        "excerpt: Body text about typed decisions.",
      ].join("\n")
    );
  });

  it("is deterministic for the same item", () => {
    expect(canonicalInputText(item)).toBe(canonicalInputText({ ...item }));
  });

  it("omits absent fields instead of emitting empty lines", () => {
    const anonymous = canonicalInputText({ ...item, author: null, body: null });
    expect(anonymous).not.toContain("author:");
    expect(anonymous).not.toContain("excerpt:");
  });

  it("never includes the item id", () => {
    const withId = canonicalInputText({ ...item, id: "reddit-abc123" } as never);
    expect(withId).not.toContain("reddit-abc123");
  });

  it("truncates the excerpt to the shared limit", () => {
    const long = canonicalInputText({ ...item, body: "x".repeat(CANONICAL_EXCERPT_CHARS * 3) });
    const excerpt = long.split("\n").find((line) => line.startsWith("excerpt: ")) as string;
    expect(excerpt.slice("excerpt: ".length)).toHaveLength(CANONICAL_EXCERPT_CHARS);
  });

  it("distinguishes items that differ only in one field", () => {
    expect(canonicalInputText(item)).not.toBe(canonicalInputText({ ...item, title: "Something else" }));
  });

  it("carries a version, so a layout change is a contract change", () => {
    expect(CANONICAL_INPUT_VERSION).toBe("1");
  });
});
