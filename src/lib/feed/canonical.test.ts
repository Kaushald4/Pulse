import { describe, expect, it } from "vitest";
import { canonicalUrl, groupKeyFor } from "./canonical";

describe("canonicalUrl", () => {
  it("drops tracking parameters but keeps the ones that identify the page", () => {
    expect(canonicalUrl("https://example.com/post?utm_source=hn&utm_campaign=x")).toBe(
      "https://example.com/post"
    );
    expect(canonicalUrl("https://example.com/post?fbclid=abc&ref=hn")).toBe("https://example.com/post");
    expect(canonicalUrl("https://example.com/watch?v=abc123")).toBe("https://example.com/watch?v=abc123");
    expect(canonicalUrl("https://example.com/p?id=42&utm_medium=email")).toBe("https://example.com/p?id=42");
  });

  it("does not merge links that only look similar", () => {
    expect(canonicalUrl("https://example.com/watch?v=a")).not.toBe(
      canonicalUrl("https://example.com/watch?v=b")
    );
    expect(canonicalUrl("https://example.com/a")).not.toBe(canonicalUrl("https://example.com/b"));
  });

  it("treats the same page reached differently as one key", () => {
    const target = "https://example.com/post";
    expect(canonicalUrl("https://www.example.com/post/")).toBe(target);
    expect(canonicalUrl("https://EXAMPLE.com/post#section")).toBe(target);
    expect(canonicalUrl("http://example.com/post")).toBe(target);
    expect(canonicalUrl("  https://example.com/post  ")).toBe(target);
    expect(canonicalUrl("https://example.com/post?b=2&a=1")).toBe(
      canonicalUrl("https://example.com/post?a=1&b=2")
    );
  });

  it("leaves the root path alone", () => {
    expect(canonicalUrl("https://example.com")).toBe("https://example.com/");
    expect(canonicalUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("refuses anything that is not a web page", () => {
    expect(canonicalUrl("mailto:someone@example.com")).toBeNull();
    expect(canonicalUrl("file:///Users/me/notes.md")).toBeNull();
    expect(canonicalUrl("not a url")).toBeNull();
    expect(canonicalUrl("")).toBeNull();
  });

  it("keeps the port when one is given", () => {
    expect(canonicalUrl("http://localhost:3000/a")).toBe("https://localhost:3000/a");
  });
});

describe("groupKeyFor", () => {
  it("uses the canonical URL when there is one", () => {
    expect(groupKeyFor({ id: "hn-1", url: "https://www.example.com/post?utm_source=hn" })).toBe(
      "https://example.com/post"
    );
  });

  it("falls back to the item's own id, so it stays a group of one", () => {
    expect(groupKeyFor({ id: "hn-1", url: "" })).toBe("item:hn-1");
    expect(groupKeyFor({ id: "hn-2", url: "" })).not.toBe(groupKeyFor({ id: "hn-3", url: "" }));
  });
});
