/**
 * Deterministic, no-LLM resource detection - a port of journal's
 * `sync/src/resource-detection.ts` so Pulse catalogs resources the same way.
 *
 * Two kinds of input:
 *   `primaryUrl` - the item's own outbound link, promoted **only** when it is a
 *     genuinely named tool (repo/product/paper/model). A news or blog item's own
 *     permalink is already fully represented by the item itself, so promoting it
 *     would flood Resources with article hosts.
 *   `text` - scanned for any additional URLs mentioned in the title/body. This is
 *     unrestricted: an article that mentions a GitHub repo still surfaces that
 *     repo, and an unknown link still becomes "other" rather than vanishing.
 */

export type ResourceType = "repo" | "product" | "article" | "docs" | "other" | "paper" | "model";

export interface DetectedResource {
  type: ResourceType;
  url: string;
  name: string | null;
}

const GITHUB_REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i;
const NPM_RE = /^https?:\/\/(?:www\.)?npmjs\.com\/package\/([\w.@/-]+)/i;
const PYPI_RE = /^https?:\/\/(?:www\.)?pypi\.org\/project\/([\w.-]+)/i;
const CRATES_RE = /^https?:\/\/(?:www\.)?crates\.io\/crates\/([\w.-]+)/i;
const ARXIV_RE = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([\w.-]+)/i;
const HF_PAPER_RE = /^https?:\/\/(?:www\.)?huggingface\.co\/papers\/([\w.-]+)/i;
const HF_MODEL_RE =
  /^https?:\/\/(?:www\.)?huggingface\.co\/(?!papers\/|datasets\/|spaces\/|docs\/|blog\/)([\w.-]+)\/([\w.-]+)/i;

/**
 * Hosts that are never a resource in their own right - the platforms Pulse
 * extracts *from*, not something an item is telling you about.
 */
const EXCLUDED_HOSTS = new Set([
  "reddit.com",
  "old.reddit.com",
  "redd.it",
  "i.redd.it",
  "v.redd.it",
  "preview.redd.it",
  "x.com",
  "twitter.com",
  "t.co",
  "pbs.twimg.com",
  "video.twimg.com",
  "news.ycombinator.com",
  "lobste.rs",
  "dev.to",
  "producthunt.com",
  "www.producthunt.com",
]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[).,]+$/, "");
}

/** Classifies one external URL by domain pattern. */
export function classifyUrl(rawUrl: string): DetectedResource | null {
  const url = stripTrailingPunctuation(rawUrl);

  const github = url.match(GITHUB_REPO_RE);
  if (github) {
    const repo = stripTrailingPunctuation(github[2]);
    return { type: "repo", url: `https://github.com/${github[1]}/${repo}`, name: `${github[1]}/${repo}` };
  }

  const npm = url.match(NPM_RE);
  if (npm) return { type: "product", url: `https://npmjs.com/package/${npm[1]}`, name: npm[1] };

  const pypi = url.match(PYPI_RE);
  if (pypi) return { type: "product", url: `https://pypi.org/project/${pypi[1]}`, name: pypi[1] };

  const crates = url.match(CRATES_RE);
  if (crates) return { type: "product", url: `https://crates.io/crates/${crates[1]}`, name: crates[1] };

  const arxiv = url.match(ARXIV_RE);
  if (arxiv) return { type: "paper", url: `https://arxiv.org/abs/${arxiv[1]}`, name: `arXiv:${arxiv[1]}` };

  const hfPaper = url.match(HF_PAPER_RE);
  if (hfPaper) {
    // The slug is the arXiv id, not a title, so it carries the same prefix the
    // arXiv branch above uses. Rendered bare it reads as a broken number.
    return { type: "paper", url: `https://huggingface.co/papers/${hfPaper[1]}`, name: `HuggingFace:${hfPaper[1]}` };
  }

  const hfModel = url.match(HF_MODEL_RE);
  if (hfModel) {
    return { type: "model", url: `https://huggingface.co/${hfModel[1]}/${hfModel[2]}`, name: `${hfModel[1]}/${hfModel[2]}` };
  }

  const host = hostOf(url);
  if (!host || EXCLUDED_HOSTS.has(host)) return null;
  return { type: "other", url, name: host };
}

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

/** Types worth cataloging when they are the item's own link. */
const NAMED_TOOL_TYPES = new Set<ResourceType>(["repo", "product", "paper", "model"]);

export function detectResources(text: string, primaryUrl?: string | null): DetectedResource[] {
  const found: DetectedResource[] = [];
  const seen = new Set<string>();

  if (primaryUrl) {
    const resource = classifyUrl(primaryUrl);
    if (resource && NAMED_TOOL_TYPES.has(resource.type)) {
      seen.add(resource.url);
      found.push(resource);
    }
  }

  for (const raw of text.match(URL_RE) ?? []) {
    const resource = classifyUrl(raw);
    if (!resource || seen.has(resource.url)) continue;
    seen.add(resource.url);
    found.push(resource);
  }

  return found;
}

/** The Resources page groups journal's types into four user-facing tabs. */
export type ResourceFilter = "all" | "github" | "models" | "papers" | "sites";

export const RESOURCE_FILTERS: Array<{ id: ResourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "github", label: "GitHub" },
  { id: "models", label: "Models" },
  { id: "papers", label: "Papers" },
  { id: "sites", label: "Sites" },
];

/**
 * Resources found across a whole fetched page.
 *
 * Stricter than `detectResources`: a page's link list is mostly navigation,
 * share buttons and CDN assets, so only genuinely named tools are kept when
 * scanning whole-page text and link lists - "other" is dropped rather than
 * flooding the library with a site's own internal links.
 */
export function detectPageResources(text: string, links: string[]): DetectedResource[] {
  const found = new Map<string, DetectedResource>();

  for (const raw of links) {
    const resource = classifyUrl(raw);
    if (resource && NAMED_TOOL_TYPES.has(resource.type)) found.set(resource.url, resource);
  }

  for (const resource of detectResources(text, null)) {
    if (NAMED_TOOL_TYPES.has(resource.type)) found.set(resource.url, resource);
  }

  return Array.from(found.values()).slice(0, 20);
}

export function matchesResourceFilter(type: ResourceType, filter: ResourceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "github":
      return type === "repo";
    case "models":
      return type === "model";
    case "papers":
      return type === "paper";
    case "sites":
      return type === "product" || type === "article" || type === "docs" || type === "other";
  }
}

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  repo: "repo",
  product: "product",
  article: "article",
  docs: "docs",
  other: "site",
  paper: "paper",
  model: "model",
};
