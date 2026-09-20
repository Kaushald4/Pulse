/**
 * Whatever shape a provider hands back, turned into a PulseItem - with the
 * heuristic classification already applied, so a new item is never blank.
 */
import type { PulseItem } from "../types";
import { heuristicClassify } from "../classify/heuristic";

export function toIso(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function joinNames(value: unknown): string {
  return Array.isArray(value) ? value.map(text).filter(Boolean).join(", ") : text(value);
}

interface BaseInput {
  id: string;
  source: string;
  sourceType: string;
  title: string;
  url: string;
  body?: string | null;
  author?: string | null;
  authorUrl?: string | null;
  score?: number;
  commentsCount?: number;
  publishedAt?: string;
  tags?: string[];
}

export function baseItem(input: BaseInput): PulseItem {
  const heuristic = heuristicClassify({
    title: input.title,
    body: input.body ?? null,
    url: input.url,
    source: input.source,
  });

  return {
    id: input.id,
    source: input.source,
    sourceType: input.sourceType,
    category: heuristic.category,
    field: heuristic.field,
    title: input.title,
    url: input.url,
    body: input.body ?? null,
    author: input.author ?? null,
    authorUrl: input.authorUrl ?? null,
    score: input.score ?? 0,
    commentsCount: input.commentsCount ?? 0,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    state: "inbox",
    tags: Array.from(new Set([...(input.tags ?? []), ...heuristic.tags])),
    extractedResources: heuristic.extractedResources,
    createdAt: new Date().toISOString(),
  };
}
