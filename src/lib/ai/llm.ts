import type { PulseItem } from "../types";
import { isTauriEnv } from "../config";
import { parseJsonLoose } from "../utils";
import { WHY_LABELS } from "./taxonomy";
import { readUsage, type RawUsage } from "./usage";

export interface LlmResult {
  text: string;
  model?: string;
  usage?: RawUsage;
}

export interface TokenUse {
  inputTokens: number;
  outputTokens: number;
  model: string | null;
}

export function usageOf(result: LlmResult | null): TokenUse {
  const { inputTokens, outputTokens } = readUsage(result?.usage);
  return {
    inputTokens,
    outputTokens,
    model: result?.model ?? null,
  };
}

/**
 * The same generation call, but it reports failure instead of returning null.
 *
 * Callers that already have a sensible fallback (the briefing, "why it
 * matters") use `callLlm`; the jobs pipeline needs to tell "the request
 * failed" apart from "the model said nothing", so it uses this.
 */
export async function callLlmStrict(system: string, prompt: string, json: boolean): Promise<LlmResult> {
  if (!isTauriEnv()) throw new Error("AI calls need the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LlmResult>("ai_chat", {
    call: { task: "generation", system, prompt, json },
  });
}

async function callLlm(system: string, prompt: string, json: boolean): Promise<LlmResult | null> {
  try {
    return await callLlmStrict(system, prompt, json);
  } catch (err) {
    console.warn("[Pulse] Generation call failed:", err);
    return null;
  }
}

interface ReasonPayload {
  items?: Array<{ id?: string; why?: string }>;
}

/**
 * One sentence per item explaining why it matters, grounded in the Jev
 * classification/score already attached to it. Falls back to the Jev "why"
 * category label so the field is never empty.
 */
export async function generateReasons(
  items: PulseItem[]
): Promise<{ reasons: Map<string, string>; usage: TokenUse }> {
  const reasons = new Map<string, string>();
  const empty = { inputTokens: 0, outputTokens: 0, model: null };
  if (items.length === 0) return { reasons, usage: empty };

  const payload = items.map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    topic: item.topic ?? "other",
    category: item.category,
    signal: item.signal ?? null,
    whyKey: item.whyKey ?? null,
  }));

  const result = await callLlm(
    "You write terse, factual one-line notes for a senior engineer's reading queue. No hype, no marketing language, no emoji. Each note states concretely what the item is and why it may matter. Never invent facts not present in the input.",
    `For each item below, write one sentence (max 22 words) explaining why it matters. Return JSON only: {"items":[{"id":"<id>","why":"<sentence>"}]}\n\nItems:\n${JSON.stringify(payload)}`,
    true
  );

  const parsed = parseJsonLoose<ReasonPayload>(result?.text);
  for (const entry of parsed?.items ?? []) {
    if (entry?.id && typeof entry.why === "string" && entry.why.trim()) {
      reasons.set(entry.id, entry.why.trim());
    }
  }

  for (const item of items) {
    if (!reasons.has(item.id)) {
      reasons.set(item.id, WHY_LABELS[item.whyKey ?? "other"] ?? WHY_LABELS.other);
    }
  }

  return { reasons, usage: usageOf(result) };
}

export interface BriefingDraft {
  summary: string;
  keyHappenings: string[];
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

interface BriefingPayload {
  summary?: string;
  keyHappenings?: string[];
}

/**
 * Writes the daily briefing from a structured payload the app already computed.
 *
 * The model narrates; it does not choose what is important. Selection happened
 * before this point - by the classifier's signal where available, engagement
 * where not, with a per-source cap so one feed cannot fill the list.
 *
 * `topics` is counted from these same items, so every count can be traced to
 * something in `items`. It is omitted entirely when nothing has been classified,
 * rather than sent empty for the model to comment on.
 */
export async function generateBriefing(input: {
  date: string;
  items: PulseItem[];
  topics: Array<{ topic: string; count: number }>;
}): Promise<BriefingDraft> {
  const { date, items, topics } = input;

  const fallback: BriefingDraft = {
    summary: buildTemplatedSummary(items, topics),
    keyHappenings: items.slice(0, 4).map((item) => `${item.title} (${item.source})`),
    model: null,
    inputTokens: 0,
    outputTokens: 0,
  };
  if (items.length === 0) return fallback;

  const payload: Record<string, unknown> = {
    date,
    itemCount: items.length,
    items: items.map((item) => ({
      title: item.title,
      source: item.source,
      category: item.category,
      score: item.score,
      comments: item.commentsCount,
      topic: item.topic ?? null,
      signal: item.signal ?? null,
      why: item.why ?? null,
    })),
  };
  if (topics.length > 0) payload.topics = topics;

  const result = await callLlm(
    [
      "You write a short daily technical briefing for a senior engineer.",
      "Ground every statement in the supplied items; never invent facts, numbers, or names.",
      "The items are the complete set for the day - do not speculate about what else may exist.",
      "If the items are thin or low-value, say so plainly in one sentence rather than padding.",
      "Plain prose, no marketing tone, no emoji.",
    ].join(" "),
    `Write today's briefing from this data. Return JSON only: {"summary":"<2-3 sentence overview>","keyHappenings":["<4-6 concrete bullets>"]}\n\nData:\n${JSON.stringify(payload)}`,
    true
  );

  const parsed = parseJsonLoose<BriefingPayload>(result?.text);
  const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
  const happenings = Array.isArray(parsed?.keyHappenings)
    ? parsed.keyHappenings.filter((h): h is string => typeof h === "string" && Boolean(h.trim())).slice(0, 6)
    : [];

  if (!summary || happenings.length === 0) return fallback;

  const usage = usageOf(result);
  return {
    summary,
    keyHappenings: happenings,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

function buildTemplatedSummary(items: PulseItem[], topics: Array<{ topic: string; count: number }>): string {
  if (items.length === 0) {
    return "No items have been collected today. Run a sync to pull fresh content.";
  }
  const top = topics[0];
  const sources = Array.from(new Set(items.map((item) => item.source)))
    .slice(0, 4)
    .join(", ");
  const leader = items[0];
  return [
    `${items.length} items collected today from ${sources}.`,
    top ? `The busiest topic is #${top.topic} (${top.count} items).` : "",
    leader ? `Most recent: "${leader.title}".` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
