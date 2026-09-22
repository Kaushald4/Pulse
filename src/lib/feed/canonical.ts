/**
 * The dedupe key for a link.
 *
 * One story reaches Pulse through several sources, each with its own URL: a
 * Hacker News link with `?utm_source=`, an RSS entry with `?ref=`, a
 * capitalised host, a trailing slash, a `#fragment`. Those are all the same
 * story, so the feed needs one key for them.
 *
 * Deliberately conservative. Only parameters known to be tracking are dropped,
 * never everything except a whitelist, because a meaningless-looking parameter
 * can be the one that identifies the page (`?v=` on YouTube, `?id=` anywhere).
 * Anything unrecognised survives, which means a missed duplicate rather than a
 * wrong merge.
 */

/** Query parameters that only ever describe where a click came from. */
const TRACKING_PARAMETERS: RegExp[] = [
  /^utm_/, // utm_source, utm_campaign, ...
  /^fbclid$/,
  /^gclid$/,
  /^dclid$/,
  /^msclkid$/,
  /^twclid$/,
  /^yclid$/,
  /^igshid$/,
  /^mc_cid$/,
  /^mc_eid$/,
  /^mkt_tok$/,
  /^_hsenc$/,
  /^_hsmi$/,
  /^vero_id$/,
  /^oly_anon_id$/,
  /^oly_enc_id$/,
  /^ref$/,
  /^ref_src$/,
  /^ref_url$/,
  /^source$/,
  /^si$/, // YouTube's share links
];

function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_PARAMETERS.some((pattern) => pattern.test(lower));
}

/** The path with a trailing slash removed, but the root left alone. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/**
 * The key for a URL, or null when it is not a link to a story.
 *
 * http and https are treated as the same page, since they nearly always are,
 * and remaining parameters are sorted so that parameter order cannot split a
 * group.
 */
export function canonicalUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  // Anything that is not a web page (mailto:, file:, data:) is not a story.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  // A port is part of the address, not decoration. `URL` has already dropped it
  // when it is the protocol default.
  const authority = url.port ? `${host}:${url.port}` : host;

  const kept: Array<[string, string]> = [];
  for (const [name, value] of url.searchParams) {
    if (!isTracking(name)) kept.push([name, value]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));

  const query = kept.map(([name, value]) => `${name}=${value}`).join("&");
  const path = normalizePath(url.pathname);

  // Built by hand rather than by mutating the URL, so the result is exactly the
  // key shape the tests describe rather than whatever `URL` normalises to.
  return `https://${authority}${path}${query ? `?${query}` : ""}`;
}

/**
 * The key to group an item by.
 *
 * An item whose URL cannot be read keeps its own id as the key, so it stays a
 * group of one instead of being merged into a shared "unknown" bucket.
 */
export function groupKeyFor(item: { id: string; url: string }): string {
  return canonicalUrl(item.url) ?? `item:${item.id}`;
}
