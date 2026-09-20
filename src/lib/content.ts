import type { PulseItem } from "./types";
import { isTauriEnv } from "./config";
import { applyContent, applyReasons, applyResources, finishRun, startRun } from "./db/sqlite";
import { detectPageResources, type DetectedResource } from "./resources";
import { readUsage, type RawUsage } from "./ai/usage";

interface ExtractedContent {
  url: string;
  engine: string;
  title: string | null;
  text: string;
  author: string | null;
  publishedDate: string | null;
  imageUrl: string | null;
  siteName: string | null;
  favicon: string | null;
  links: string[];
}

/** Keep the model's input bounded; a long page is truncated, not rejected. */
const MAX_SUMMARY_INPUT = 12000;

async function summarize(
  title: string,
  text: string
): Promise<{ summary: string | null; model: string | null; inputTokens: number; outputTokens: number }> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{
      text: string;
      model?: string;
      usage?: RawUsage;
    }>("ai_chat", {
      call: {
        task: "generation",
        system:
          "You summarise a single web page for a technical reader. Be concrete and neutral: what it is, its key claims or findings, and anything actionable. Do not add facts that are not in the text. Plain prose, no headings, no markdown.",
        prompt: `Summarise this page in 3-5 sentences.\n\nTitle: ${title}\n\n${text.slice(0, MAX_SUMMARY_INPUT)}`,
        json: false,
      },
    });
    const { inputTokens, outputTokens } = readUsage(result?.usage);
    return {
      summary: result?.text?.trim() || null,
      model: result?.model ?? null,
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    console.warn("[Pulse] Summarisation failed:", err);
    return { summary: null, model: null, inputTokens: 0, outputTokens: 0 };
  }
}

export interface ContentResult {
  engine: string;
  summary: string | null;
  characters: number;
  capturedResources: DetectedResource[];
}

/**
 * Fetches a page's full content with the configured engine, summarises it, and
 * persists both, so the content survives an app restart.
 *
 * Any named tool the page points at is merged into the item's resources, which
 * is how the caller can report "captured 3 resources" afterwards.
 */
export async function fetchAndSummarize(item: PulseItem): Promise<ContentResult> {
  if (!isTauriEnv()) {
    throw new Error("Fetching content requires the desktop app.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const runId = await startRun({ category: "content", label: item.title.slice(0, 60) });

  try {
    const extracted = await invoke<ExtractedContent>("extract_content", { url: item.url });

    const text = extracted.text ?? "";
    const written = await summarize(extracted.title ?? item.title, text);

    await applyContent(item.id, {
      text,
      summary: written.summary,
      engine: extracted.engine,
      imageUrl: extracted.imageUrl,
      siteName: extracted.siteName,
    });

    const capturedResources = detectPageResources(text, extracted.links ?? []);
    if (capturedResources.length > 0) {
      const merged = new Map<string, DetectedResource>();
      for (const existing of item.extractedResources ?? []) merged.set(existing.url, existing);
      for (const found of capturedResources) merged.set(found.url, found);
      await applyResources(item.id, Array.from(merged.values()));
    }

    await finishRun(runId, {
      status: "success",
      items: capturedResources.length,
      summary:
        `${text.length.toLocaleString()} characters via ${extracted.engine}` +
        (capturedResources.length > 0 ? ` · ${capturedResources.length} resources` : ""),
      model: written.model,
      inputTokens: written.inputTokens,
      outputTokens: written.outputTokens,
    });

    return {
      engine: extracted.engine,
      summary: written.summary,
      characters: text.length,
      capturedResources,
    };
  } catch (err) {
    await finishRun(runId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
