/**
 * The one place an item becomes model input.
 *
 * The teacher and a local model have to see the same item, and the exported
 * training dataset stores the finished string rather than raw rows, so Python
 * never rebuilds this layout and Rust only tokenizes it. A fixture test pins the
 * exact output, and the dataset export reuses the same function, which is what
 * keeps training input and inference input identical for a given item.
 *
 * The item id is deliberately absent. It carries no meaning, and including it
 * would let a model memorise rows instead of reading them.
 *
 * Bump CANONICAL_INPUT_VERSION whenever the layout or the truncation changes. A
 * model trained on the old layout is not interchangeable with the new one, and
 * the runtime manifest records the version it was trained against.
 */
import type { PulseItem } from "../types";

export const CANONICAL_INPUT_VERSION = "1";

/** The same excerpt length the teacher is given, so both see the same evidence. */
export const CANONICAL_EXCERPT_CHARS = 600;

export type CanonicalInputItem = Pick<PulseItem, "title" | "source" | "url" | "author" | "body">;

/** The body excerpt both engines are given. Whole articles are never sent. */
export function canonicalExcerpt(body: string | null | undefined): string {
  return (body ?? "").slice(0, CANONICAL_EXCERPT_CHARS);
}

/**
 * A deterministic, labelled, line-oriented rendering of an item.
 *
 * Labels are kept so the encoder can tell a title from a URL, and absent fields
 * are omitted rather than emitted empty, so an item without an author does not
 * carry a line that says nothing.
 */
export function canonicalInputText(item: CanonicalInputItem): string {
  const lines = [`title: ${item.title.trim()}`, `source: ${item.source.trim()}`];

  const author = (item.author ?? "").trim();
  if (author) lines.push(`author: ${author}`);

  const url = item.url.trim();
  if (url) lines.push(`url: ${url}`);

  const excerpt = canonicalExcerpt(item.body).trim();
  if (excerpt) lines.push(`excerpt: ${excerpt}`);

  return lines.join("\n");
}
