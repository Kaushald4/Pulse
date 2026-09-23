/**
 * The classification vocabulary, in one place.
 *
 * This is the source of truth for three things at once: what `finalize` accepts,
 * what the teacher is asked for, and what a local model must be able to output.
 * `taxonomy.json` is generated from this module for the offline trainer, so
 * Python, Rust and TypeScript cannot drift apart, and a test asserts the export
 * still matches what is declared here.
 *
 * `signal` is ordinal. Its levels are ordered and the head is declared as
 * `score` rather than `choice`, so nothing downstream treats it as four
 * unrelated classes.
 */
import type { ContentFieldValue } from "../types";

/** Bumped when a value is added, removed or reordered. */
export const TAXONOMY_VERSION = "1";

export const CATEGORY_OPTIONS = ["repo", "paper", "resource", "news"] as const;

export const FIELD_OPTIONS: ContentFieldValue[] = [
  "ai_ml",
  "systems_infra",
  "web_frontend",
  "developer_tools",
  "security",
  "data",
  "other",
];

/** Bounded topic vocabulary. Gives Rising Topics a stable key to aggregate on. */
export const TOPIC_OPTIONS = [
  "llm-agents",
  "model-releases",
  "inference-serving",
  "training-methods",
  "systems-runtime",
  "databases-storage",
  "web-frontend",
  "dev-tooling",
  "security-privacy",
  "browser-automation",
  "open-source",
  "hardware-chips",
  "networking-distributed",
  "developer-experience",
  "benchmarks-eval",
  "other",
];

/** Ordinal, lowest first. The index is the level. */
export const SIGNAL_LEVELS = [
  "Noise; promotion, spam, or off-topic filler with no engineering value",
  "Peripheral; mildly interesting but skippable for someone tracking this space",
  "Useful; worth a look for an engineer working in this area",
  "High-signal must-read; a significant development likely to matter for weeks",
];

export const WHY_OPTIONS = [
  "new-tool-release",
  "major-model-release",
  "systems-technique",
  "security-incident",
  "benchmark-or-paper",
  "community-debate",
  "other",
];

export const WHY_LABELS: Record<string, string> = {
  "new-tool-release": "New tool or library release",
  "major-model-release": "Major model release",
  "systems-technique": "Systems or infrastructure technique",
  "security-incident": "Security or privacy finding",
  "benchmark-or-paper": "Benchmark or research result",
  "community-debate": "Ongoing community debate",
  other: "Notable development",
};

/** Every head a PulseClassify model may contain. A model may declare a subset. */
export const HEADS = ["category", "field", "topic", "signal", "primary", "whyKey"] as const;

export type Head = (typeof HEADS)[number];

export type HeadKind = "choice" | "score" | "noul";

/** Mirrors the teacher's question types, so the contract has one definition. */
export const HEAD_KINDS: Record<Head, HeadKind> = {
  category: "choice",
  field: "choice",
  topic: "choice",
  signal: "score",
  primary: "noul",
  whyKey: "choice",
};

/** The values a head may output, in order. `primary` is false then true. */
export const HEAD_VALUES: Record<Head, readonly string[]> = {
  category: CATEGORY_OPTIONS,
  field: FIELD_OPTIONS,
  topic: TOPIC_OPTIONS,
  signal: SIGNAL_LEVELS,
  primary: ["false", "true"],
  whyKey: WHY_OPTIONS,
};

export interface TaxonomyHead {
  kind: HeadKind;
  cardinality: number;
  values: readonly string[];
}

export interface Taxonomy {
  version: string;
  heads: Record<Head, TaxonomyHead>;
  whyLabels: Record<string, string>;
  /** Stated explicitly so a consumer cannot read the levels as unordered. */
  signalOrdinal: true;
}

/** The machine-readable taxonomy the offline trainer reads. */
export function buildTaxonomy(): Taxonomy {
  const heads = {} as Record<Head, TaxonomyHead>;
  for (const head of HEADS) {
    heads[head] = {
      kind: HEAD_KINDS[head],
      cardinality: HEAD_VALUES[head].length,
      values: HEAD_VALUES[head],
    };
  }
  return { version: TAXONOMY_VERSION, heads, whyLabels: WHY_LABELS, signalOrdinal: true };
}
