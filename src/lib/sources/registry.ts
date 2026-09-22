/**
 * The fetcher map: which extractor answers for each source. Adding a source
 * means one case here and one fetcher file. What a source needs to run lives in
 * `auth.ts`.
 */
import type { PulseItem, SourceConnection, SourceOptions } from "../types";
import { requireDesktop } from "./helmsman";
import { fetchHackerNews, fetchLobsters, fetchRss } from "./fetchers/aggregators";
import { fetchArxiv, fetchDevTo, fetchGithub, fetchHuggingFace, fetchProductHunt } from "./fetchers/catalogs";
import { fetchLinkedIn, fetchReddit, fetchTwitter } from "./fetchers/social";

export async function fetchSource(source: SourceConnection): Promise<PulseItem[]> {
  requireDesktop();

  const profile = source.profileName?.trim() || "default";
  const options: SourceOptions = source.options ?? {};

  switch (source.source) {
    case "hackernews":
      return fetchHackerNews(options);
    case "lobsters":
      return fetchLobsters(options);
    case "arxiv":
      return fetchArxiv(options);
    case "huggingface":
      return fetchHuggingFace(options);
    case "devto":
      return fetchDevTo(options);
    case "producthunt":
      return fetchProductHunt(options);
    case "github":
      return fetchGithub(options);
    case "rss":
      return fetchRss(source.source, options);
    case "reddit":
      return fetchReddit(profile, options);
    case "twitter":
      return fetchTwitter(profile, options);
    case "linkedin":
      return fetchLinkedIn(profile, options);
    default:
      throw new Error(`No extractor implemented for source "${source.source}".`);
  }
}
