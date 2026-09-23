import type { ClassifierEngine, ContentFieldValue, ItemCategory, PulseItem } from "../types";
import { heuristicClassify } from "../classify/heuristic";
import { getConfig, isTauriEnv } from "../config";
import { hashContent, parseJsonLoose } from "../utils";
import { CATEGORY_OPTIONS, FIELD_OPTIONS, SIGNAL_LEVELS, TOPIC_OPTIONS, WHY_OPTIONS } from "./taxonomy";
import { readUsage, type RawUsage } from "./usage";

export interface Classification {
  category: Exclude<ItemCategory, "all">;
  field: ContentFieldValue;
  topic: string;
  signal: number | null;
  primarySource: boolean | null;
  whyKey: string;
  classifierModel: string | null;
  classifierConfidence: number | null;
  contentHash: string;
  tags: string[];
  extractedResources: PulseItem["extractedResources"];
}

/** Values as returned by either engine, before validation. */
interface RawClassification {
  category?: unknown;
  field?: unknown;
  topic?: unknown;
  signalLevel?: number | null;
  primary?: unknown;
  whyKey?: unknown;
  confidence?: number | null;
}

function pick(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Validates raw model output into a Classification. Anything missing or
 * off-vocabulary falls back to the deterministic heuristic rather than being
 * trusted blindly.
 */
export function finalize(
  item: PulseItem,
  raw: RawClassification,
  model: string | null,
  contentHash: string
): Classification {
  const heuristic = heuristicClassify(item);

  const category = pick(raw.category, CATEGORY_OPTIONS, heuristic.category) as Classification["category"];
  const field = pick(raw.field, FIELD_OPTIONS, heuristic.field) as ContentFieldValue;
  const topic = pick(raw.topic, TOPIC_OPTIONS, "other");
  const whyKey = pick(raw.whyKey, WHY_OPTIONS, "other");

  const signal =
    typeof raw.signalLevel === "number" ? clamp01(raw.signalLevel / (SIGNAL_LEVELS.length - 1)) : null;

  const primarySource = typeof raw.primary === "boolean" ? raw.primary : null;

  return {
    category,
    field,
    topic,
    signal,
    primarySource,
    whyKey,
    classifierModel: model,
    classifierConfidence: typeof raw.confidence === "number" ? clamp01(raw.confidence) : null,
    contentHash,
    // Resource URLs are parsed deterministically - that is URL structure, not semantics.
    extractedResources: heuristic.extractedResources,
    tags: Array.from(new Set([topic, ...heuristic.tags])).slice(0, 6),
  };
}

/* -------------------------------------------------------------------------- */
/* Jev (Cloudflare System One)                                                 */
/* -------------------------------------------------------------------------- */

interface JevQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria: unknown;
}

function buildJevQuestions(): Record<string, JevQuestion> {
  return {
    category: {
      type: "choice",
      instructions:
        "What kind of technical content is this? A repository/hosted tool the user can use, a research paper/preprint, a product or reference site/resource, or news/commentary?",
      criteria: {
        repo: "A code repository or downloadable software project",
        paper: "A research paper, preprint, or academic benchmark",
        resource: "A product, service, documentation site, or curated reference",
        news: "News, opinion, discussion thread, or commentary",
      },
    },
    field: {
      type: "choice",
      instructions: "Which engineering field does this content primarily belong to?",
      criteria: {
        ai_ml: "Machine learning, models, training, or inference",
        systems_infra: "Operating systems, runtimes, compilers, infra, or performance",
        web_frontend: "Browsers, frontend frameworks, UI, or web platform",
        developer_tools: "Developer tooling, CLIs, editors, build systems, workflows",
        security: "Security, privacy, vulnerabilities, or evasion",
        data: "Data engineering, databases, storage, or pipelines",
        other: "Does not fit the categories above",
      },
    },
    topic: {
      type: "choice",
      instructions: "Which single topic best summarizes this content?",
      criteria: TOPIC_OPTIONS.reduce<Record<string, null>>((acc, topic) => {
        acc[topic] = null;
        return acc;
      }, {}),
    },
    signal: {
      type: "score",
      instructions:
        "How much signal does this carry for a senior engineer who tracks AI, systems, and developer tooling? Ignore popularity metrics; judge engineering substance.",
      criteria: SIGNAL_LEVELS,
    },
    primary: {
      type: "noul",
      instructions:
        "Is this a primary technical source - an original repository, paper, official release, or first-hand engineering write-up - rather than commentary, a listicle, or promotion?",
      criteria: {
        true: "Original artifact or first-hand technical account",
        false: "Commentary, aggregation, listicle, or promotion",
      },
    },
    why: {
      type: "choice",
      instructions: "Why would this matter to that engineer?",
      criteria: WHY_OPTIONS.reduce<Record<string, null>>((acc, option) => {
        acc[option] = null;
        return acc;
      }, {}),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

interface JevOutcome {
  id: string;
  ok: boolean;
  model?: string;
  answers?: Record<string, unknown>;
  usage?: RawUsage;
  error?: string;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
}

function addUsage(total: Usage, usage?: RawUsage): void {
  const { inputTokens, outputTokens } = readUsage(usage);
  total.inputTokens += inputTokens;
  total.outputTokens += outputTokens;
}

async function classifyWithJev(
  items: PulseItem[],
  model: string
): Promise<{
  classifications: Map<string, Classification>;
  errors: string[];
  models: string[];
  usage: Usage;
}> {
  const classifications = new Map<string, Classification>();
  const errors: string[] = [];
  const models: string[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  const questions = buildJevQuestions();
  const hashById = new Map<string, string>();
  const calls = items.map((item) => {
    const contentHash = hashContent(item.title, item.url, item.body);
    hashById.set(item.id, contentHash);
    return {
      id: item.id,
      state: {
        title: item.title,
        url: item.url,
        source: item.source,
        author: item.author ?? "",
        published_at: item.publishedAt,
        body: (item.body ?? "").slice(0, 4000),
      },
      questions,
    };
  });

  const { invoke } = await import("@tauri-apps/api/core");
  const outcomes = await invoke<JevOutcome[]>("ai_jev", { calls, concurrency: 6 });
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const outcome of outcomes) {
    if (outcome.model) models.push(outcome.model);
    addUsage(usage, outcome.usage);

    const item = byId.get(outcome.id);
    if (!item) continue;
    if (!outcome.ok) {
      errors.push(`${item.title.slice(0, 60)}: ${outcome.error ?? "unknown error"}`);
      continue;
    }

    const answers = asRecord(outcome.answers);
    const signalAnswer = asRecord(answers.signal);
    const primaryAnswer = asRecord(answers.primary);
    const confidences = [answers.category, answers.field, answers.topic, answers.why, answers.signal]
      .map((answer) => asRecord(answer).confidence)
      .filter((value): value is number => typeof value === "number");

    classifications.set(
      outcome.id,
      finalize(
        item,
        {
          category: asRecord(answers.category).choice,
          field: asRecord(answers.field).choice,
          topic: asRecord(answers.topic).choice,
          signalLevel: typeof signalAnswer.score === "number" ? signalAnswer.score : null,
          primary: typeof primaryAnswer.noul === "number" ? primaryAnswer.noul >= 0.5 : null,
          whyKey: asRecord(answers.why).choice,
          confidence: confidences.length
            ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
            : null,
        },
        outcome.model ?? model,
        hashById.get(item.id) ?? ""
      )
    );
  }

  return { classifications, errors, models, usage };
}

/* -------------------------------------------------------------------------- */
/* LLM JSON-mode classification                                                */
/* -------------------------------------------------------------------------- */

/** Reused by the label audit, so a batch is the same size in both places. */
export const LLM_CHUNK_SIZE = 8;

export const LLM_SYSTEM = [
  "You classify technical content for a personal reading tracker.",
  "Use only the allowed values given in the prompt. Never invent facts.",
  "Reply with JSON only - no prose, no markdown fences.",
].join(" ");

/**
 * The fields the teacher is asked about. Narrower than `PulseItem` so the audit
 * can build the identical prompt from database columns.
 */
export type TeacherPromptItem = Pick<PulseItem, "id" | "title" | "source" | "url" | "author" | "body">;

export function buildLlmPrompt(items: TeacherPromptItem[]): string {
  const payload = items.map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    url: item.url,
    author: item.author ?? "",
    excerpt: (item.body ?? "").slice(0, 600),
  }));

  const signalScale = SIGNAL_LEVELS.map((level, index) => `${index} = ${level}`).join("; ");

  return [
    "Classify each item below.",
    "",
    "Allowed values:",
    `- category: ${CATEGORY_OPTIONS.join(" | ")}`,
    `- field: ${FIELD_OPTIONS.join(" | ")}`,
    `- topic: ${TOPIC_OPTIONS.join(" | ")}`,
    `- signal: integer 0-3, where ${signalScale}`,
    "- primary: true when this is a primary technical source (original repo, paper, official release, first-hand write-up) rather than commentary, a listicle, or promotion",
    `- whyKey: ${WHY_OPTIONS.join(" | ")}`,
    "",
    'Return exactly this shape: {"items":[{"id":"<id>","category":"...","field":"...","topic":"...","signal":2,"primary":true,"whyKey":"..."}]}',
    "",
    "Items:",
    JSON.stringify(payload),
  ].join("\n");
}

export interface LlmClassificationEntry {
  id?: string;
  category?: unknown;
  field?: unknown;
  topic?: unknown;
  signal?: unknown;
  primary?: unknown;
  whyKey?: unknown;
}

interface LlmClassificationPayload {
  items?: LlmClassificationEntry[];
}

/**
 * One item's answer, mapped to the shape `finalize` validates.
 *
 * Shared with the label audit, so the audit measures this mapping rather than a
 * copy of it and any change here shows up in the next audit run.
 */
export function llmEntryToRaw(entry: LlmClassificationEntry): RawClassification {
  return {
    category: entry.category,
    field: entry.field,
    topic: entry.topic,
    signalLevel: typeof entry.signal === "number" ? entry.signal : null,
    primary: typeof entry.primary === "boolean" ? entry.primary : null,
    whyKey: entry.whyKey,
  };
}

async function classifyWithLlm(
  items: PulseItem[],
  model: string
): Promise<{
  classifications: Map<string, Classification>;
  errors: string[];
  models: string[];
  usage: Usage;
}> {
  const classifications = new Map<string, Classification>();
  const errors: string[] = [];
  const models: string[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const byId = new Map(items.map((item) => [item.id, item]));
  const { invoke } = await import("@tauri-apps/api/core");

  for (let start = 0; start < items.length; start += LLM_CHUNK_SIZE) {
    const chunk = items.slice(start, start + LLM_CHUNK_SIZE);

    try {
      const outcome = await invoke<{
        text: string;
        model?: string;
        usage?: RawUsage;
      }>("ai_chat", {
        call: {
          task: "classification",
          system: LLM_SYSTEM,
          prompt: buildLlmPrompt(chunk),
          json: true,
        },
      });

      if (outcome.model) models.push(outcome.model);
      addUsage(usage, outcome.usage);

      const parsed = parseJsonLoose<LlmClassificationPayload>(outcome.text);
      const entries = parsed?.items ?? [];
      if (entries.length === 0) {
        errors.push(`Chunk ${start / LLM_CHUNK_SIZE + 1}: model returned no usable JSON.`);
        continue;
      }

      for (const entry of entries) {
        if (!entry?.id) continue;
        const item = byId.get(entry.id);
        if (!item) continue;

        classifications.set(
          item.id,
          finalize(
            item,
            llmEntryToRaw(entry),
            outcome.model ?? model,
            hashContent(item.title, item.url, item.body)
          )
        );
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { classifications, errors, models, usage };
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

export interface ClassifyReport {
  classifications: Map<string, Classification>;
  errors: string[];
  engine: ClassifierEngine;
  /** The model that actually answered, as reported by the provider. */
  model: string | null;
  provider: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Classifies and scores a batch of items using whichever classifier the user
 * configured. Items that fail are absent from the map, so one bad call never
 * sinks a sync.
 */
export async function classifyItems(items: PulseItem[]): Promise<ClassifyReport> {
  const config = await getConfig();
  const { provider, model, engine } = config.classification;
  const useJev = provider === "cloudflare" && engine === "jev";

  if (items.length === 0) {
    return {
      classifications: new Map(),
      errors: [],
      engine: useJev ? "jev" : "llm",
      model: null,
      provider,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  if (!isTauriEnv()) {
    return {
      classifications: new Map(),
      errors: ["Classification requires the desktop app (the browser preview has no backend)."],
      engine: useJev ? "jev" : "llm",
      model: null,
      provider,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const result = useJev
    ? await classifyWithJev(items, model || "typesafe/jev")
    : await classifyWithLlm(items, model);

  return {
    classifications: result.classifications,
    errors: result.errors,
    engine: useJev ? "jev" : "llm",
    // Jev reports the resolved versioned id, which is worth logging verbatim.
    model: result.models[0] ?? (model || null),
    provider,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
}
