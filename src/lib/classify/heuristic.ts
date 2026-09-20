import type { ContentFieldValue, ExtractedResource, PulseItem } from "../types";
import { detectResources } from "../resources";

export interface HeuristicResult {
  category: "repo" | "paper" | "resource" | "news";
  field: ContentFieldValue;
  tags: string[];
  extractedResources: ExtractedResource[];
}

/**
 * Deterministic fallback used only when Jev is unreachable or unconfigured.
 *
 * Everything here is rule-based, not a model: category and field are guessed from
 * the URL and keywords, and resources are parsed straight out of the URL. The UI
 * labels results from this path as heuristic so they are never mistaken for Jev.
 */
export function heuristicClassify(item: Pick<PulseItem, "title" | "body" | "url" | "source">): HeuristicResult {
  const text = `${item.title} ${item.body ?? ""} ${item.url}`.toLowerCase();

  let category: HeuristicResult["category"] = "news";
  if (item.url.includes("github.com/") || item.source === "github") {
    category = "repo";
  } else if (
    item.url.includes("arxiv.org/") ||
    item.url.includes("huggingface.co/papers") ||
    item.source === "arxiv" ||
    item.source === "huggingface"
  ) {
    category = "paper";
  } else if (
    item.source === "devto" ||
    item.source === "producthunt" ||
    /\b(library|framework|awesome-|cheatsheet|component|boilerplate|sdk|toolkit)\b/i.test(item.title)
  ) {
    category = "resource";
  }

  let field: ContentFieldValue = "developer_tools";
  if (
    /\b(llm|gpt|transformer|attention|deepseek|openai|gemini|diffusion|inference|quantization|lora|rlhf|grpo|mcts|weights|vllm|sglang|cuda|rag)\b/i.test(
      text
    )
  ) {
    field = "ai_ml";
  } else if (
    /\b(rust|c\+\+|kernel|linux|compiler|memory|distributed|concurrency|sqlite|postgres|database|socket|network|chromium|webkit|tauri|zig)\b/i.test(
      text
    )
  ) {
    field = "systems_infra";
  } else if (
    /\b(react|next\.js|typescript|tailwind|css|html|frontend|shadcn|vue|svelte|vite|browser|canvas|ui|ux)\b/i.test(
      text
    )
  ) {
    field = "web_frontend";
  } else if (
    /\b(security|vulnerability|exploit|cve|stealth|fingerprint|antibot|cloudflare|encryption|auth|oauth)\b/i.test(
      text
    )
  ) {
    field = "security";
  }

  const tagPatterns: Record<string, RegExp> = {
    llm: /\b(llm|large language model|weights|tokens)\b/i,
    agents: /\b(agents|autonomous|agentic|tool-calling)\b/i,
    inference: /\b(inference|serving|pagedattention|vllm|sglang)\b/i,
    rust: /\b(rust|cargo|rustc)\b/i,
    python: /\b(python|pytorch|numpy)\b/i,
    "browser-automation": /\b(playwright|puppeteer|browser|helmsman|stealth)\b/i,
    react: /\b(react|next\.js|jsx|components)\b/i,
    sqlite: /\b(sqlite|database|embedded db)\b/i,
    arxiv: /\b(arxiv|paper|preprint)\b/i,
  };

  const tags = Object.entries(tagPatterns)
    .filter(([, pattern]) => pattern.test(text))
    .map(([tag]) => tag);

  const extractedResources: ExtractedResource[] = detectResources(
    `${item.title} ${item.body ?? ""}`,
    item.url
  );

  return { category, field, tags, extractedResources };
}
