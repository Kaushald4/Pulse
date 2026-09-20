/**
 * Reader options, as the fetchers use them. Every field is optional in storage,
 * so each helper supplies the fallback and clamps to the range its source
 * actually accepts.
 */

export function list(value: string[] | undefined, fallback: string[], max = 5): string[] {
  const cleaned = (value ?? []).map((entry) => entry.trim()).filter(Boolean);
  return (cleaned.length > 0 ? cleaned : fallback).slice(0, max);
}

export function one(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

export function count(value: number | undefined, fallback: number, min = 1, max = 50): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

/** Display name for a feed URL: its host, without `www`. */
export function feedHost(feedUrl?: string): string {
  const value = (feedUrl ?? "").trim();
  if (!value) return "no feed URL";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
