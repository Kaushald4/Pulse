import type { ContentField, ItemCategory, ItemState, PulseItem } from "./types";

/** How a badge should read. Deliberately tiny — colour only carries meaning. */
export type Tone = "neutral" | "success" | "warning" | "danger";

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  all: "All",
  repo: "Repository",
  paper: "Paper",
  resource: "Product",
  news: "Discussion",
};

export const FIELD_LABELS: Record<ContentField, string> = {
  all: "All fields",
  ai_ml: "AI & ML",
  systems_infra: "Systems",
  web_frontend: "Web",
  developer_tools: "Dev tools",
  security: "Security",
  data: "Data",
  other: "Other",
};

export const STATE_LABELS: Record<ItemState, string> = {
  inbox: "Inbox",
  saved: "Reading queue",
  important: "Important",
  archived: "Archived",
};

export const SOURCE_LABELS: Record<string, string> = {
  hackernews: "Hacker News",
  github: "GitHub",
  arxiv: "arXiv",
  huggingface: "Hugging Face",
  lobsters: "Lobste.rs",
  devto: "Dev.to",
  producthunt: "Product Hunt",
  reddit: "Reddit",
  twitter: "X",
  linkedin: "LinkedIn",
  rss: "RSS",
  techcrunch: "TechCrunch",
  theverge: "The Verge",
  arstechnica: "Ars Technica",
  infoq: "InfoQ",
  "huggingface-blog": "Hugging Face Blog",
  deepmind: "Google DeepMind",
  "openai-news": "OpenAI News",
  "the-decoder": "The Decoder",
  syncedreview: "Synced",
  kdnuggets: "KDnuggets",
  towardsdatascience: "Towards Data Science",
  "nvidia-dev-blog": "NVIDIA Developer Blog",
  "github-blog": "GitHub Blog",
  "hn-frontpage": "Hacker News",
  "stackoverflow-blog": "Stack Overflow Blog",
  thenewstack: "The New Stack",
  smashingmagazine: "Smashing Magazine",
  "css-tricks": "CSS-Tricks",
  freecodecamp: "freeCodeCamp",
  sitepoint: "SitePoint",
};

/** Turns a kebab id (`training-methods`) into a readable label. */
export function humanize(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function labelFor(map: Record<string, string>, key: string | null | undefined, fallback = ""): string {
  if (!key) return fallback;
  return map[key] ?? humanize(key);
}

export function categoryLabel(category: PulseItem["category"]): string {
  return CATEGORY_LABELS[category] ?? humanize(category);
}

export function fieldLabel(field: ContentField): string {
  return FIELD_LABELS[field] ?? humanize(field);
}

export function topicLabel(topic: string): string {
  return `#${topic}`;
}

export function stateLabel(state: ItemState): string {
  return STATE_LABELS[state] ?? humanize(state);
}

/** Saved and important are the two states worth colouring; the rest are neutral. */
export function stateTone(state: ItemState): Tone {
  if (state === "important") return "warning";
  if (state === "saved") return "success";
  return "neutral";
}
