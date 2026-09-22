/**
 * The options the feed's filter bar offers, and what each window means.
 *
 * Kept pure and separate from the query so the labels, the option order and the
 * date arithmetic can be tested without a database.
 */
import { FIELD_LABELS } from "../taxonomy";
import type { ContentField } from "../types";

/** The windows a reader picks between, narrowest first. */
export type WindowKey = "today" | "day" | "week" | "all";

export const WINDOWS: Array<{ value: WindowKey; label: string }> = [
  { value: "today", label: "Today" },
  { value: "day", label: "24 hours" },
  { value: "week", label: "7 days" },
  { value: "all", label: "All time" },
];

/**
 * The ISO lower bound a window means, or undefined for all time.
 *
 * "Today" is the local calendar day, not a rolling 24 hours, so it matches the
 * Today view and resets at local midnight.
 */
export function windowSince(window: WindowKey, now: Date = new Date()): string | undefined {
  if (window === "all") return undefined;
  if (window === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.toISOString();
  }
  const hours = window === "day" ? 24 : 24 * 7;
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

export interface FacetOption {
  value: string;
  label: string;
  /** Stories that match, not rows: what clicking this option returns. */
  count: number;
}

export interface FeedFacets {
  fields: FacetOption[];
  sources: FacetOption[];
  windows: FacetOption[];
  /** Everything matching the current filters, before the list is windowed. */
  total: number;
}

/** The fields the bar offers, in reading order. "All" is added by the bar. */
export const FIELD_OPTIONS: ContentField[] = [
  "ai_ml",
  "systems_infra",
  "web_frontend",
  "developer_tools",
  "security",
  "data",
  "other",
];

export const fieldLabelFor = (field: ContentField): string => FIELD_LABELS[field] ?? field;
