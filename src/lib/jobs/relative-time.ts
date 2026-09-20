/**
 * LinkedIn's `postedAt` is a relative string ("3 days ago"), not a timestamp -
 * helmsman regex-matches it straight out of the rendered page. Approximate by
 * nature, which is fine for "how recent is this listing".
 */
const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

export function parseRelativeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unitMs = UNIT_MS[match[2].toLowerCase()];
  if (!unitMs || Number.isNaN(amount)) return null;
  return new Date(Date.now() - amount * unitMs).toISOString();
}
