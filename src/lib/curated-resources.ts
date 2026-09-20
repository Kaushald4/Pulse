import { classifyUrl } from "./resources";
import type { ExtractedResource } from "./types";

/**
 * A built-in starter catalog of links that ships with Pulse.
 *
 * These are curated, not collected: they appear in Resources on every install
 * independently of what has been synced, and carry no source item, mention
 * count, or timestamp. Each URL is classified with the same `classifyUrl` used
 * for detected links, so a GitHub repo becomes a `repo` named `owner/name` and
 * everything else becomes a `site` — nothing is hand-typed.
 */
const CURATED_URLS = [
  "https://build.nvidia.com",
  "https://novita.ai",
  "https://aistudio.google.com",
  "https://duck.ai",
  "https://pinokio.co",
  "https://arena.ai",
  "https://agent-browser.dev",
  "https://github.com/d4vinci/Scrapling",
  "https://portal.neuralwatt.com/playground",
  "https://www.cerebras.ai",
  "https://monid.ai",
  "https://www.tinyfish.ai",
  "https://jina.ai",
  "https://nosignups.net",
  "https://www.opensourcealternatives.to",
  "https://free-for.dev",
  "https://devresourc.es",
  "https://freestuff.dev",

  "https://github.com/getzep/graphiti/tree/main",
  "https://github.com/patchy631/ai-engineering-hub",
  "https://github.com/karpathy/nanoGPT",
  "https://github.com/karpathy/autoresearch",
  "https://github.com/md8-habibullah/top-github-repos-list",
  "https://github.com/LearningCircuit/local-deep-research",
  "https://github.com/different-ai/openwork",
  "https://github.com/iOfficeAI/AionUi",
  "https://github.com/modelcontextprotocol/servers",
  "https://github.com/microsoft/mcp-for-beginners/tree/main",
  "https://github.com/GetStream/Vision-Agents",
  "https://github.com/pipecat-ai/pipecat",
  "https://github.com/kyutai-labs/pocket-tts",
  "https://github.com/pipecat-ai/smart-turn",
  "https://github.com/meitarbe/cognetivy",
  "https://github.com/paperclipai/paperclip",
  "https://github.com/lightpanda-io/browser",
  "https://github.com/superset-sh/superset",
  "https://github.com/alibaba/page-agent",
  "https://github.com/k4yt3x/video2x",
  "https://github.com/bytedance/deer-flow",
  "https://github.com/h4ckf0r0day/obscura",
  "https://github.com/NdoleStudio/httpsms",
  "https://github.com/OpenHands/OpenHands",
  "https://github.com/floci-io/floci",
  "https://github.com/CodebuffAI/codebuff",
  "https://github.com/nexu-io/open-design",
  "https://github.com/suifeng9203/HeyGem.ai",
  "https://github.com/k2-fsa/OmniVoice",
  "https://github.com/cjpais/handy",
  "https://github.com/tinyhumansai/openhuman",
  "https://github.com/jackwener/opencli",
  "https://github.com/Panniantong/Agent-Reach/tree/main",
  "https://github.com/binwiederhier/ntfy",
  "https://github.com/santifer/career-ops",
  "https://github.com/pipecat-ai/pipecat-examples/tree/main",
  "https://github.com/duolahypercho/codex-router",
  "https://github.com/CristianOlivera1/openvid",
  "https://github.com/harry0703/MoneyPrinterTurbo",
  "https://github.com/onecli/onecli",
  "https://github.com/Ibexoft/awesome-startup-tools-list",
  "https://github.com/DirectorySurf/awesome-producthunt-alternatives",
  "https://github.com/huggingface/speech-to-speech",
  "https://github.com/guillaumemeyer/watermarks-remover",
  "https://github.com/tashfeenahmed/freellmapi",
  "https://github.com/diegosouzapw/OmniRoute",
  "https://github.com/opensandbox-group/OpenSandbox",
  "https://github.com/ashishps1/awesome-engineering-articles",

  "https://deepwiki.com",
  "https://remotion.com",
  "https://bugmenot.com",
  "https://www.onlinetoolkithub.com",
  "https://www.onlineide.pro/playground/python",
  "https://quillbot.com/ai-humanizer",
];

function normalize(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Drop a trailing slash or fragment so "…/#/" and "…/" collapse to one link.
  return withScheme.replace(/[/#]+$/, "");
}

/**
 * The catalog, de-duplicated case-insensitively (GitHub paths are
 * case-insensitive) and ordered by display name.
 */
export const CURATED_RESOURCES: ExtractedResource[] = (() => {
  const byKey = new Map<string, ExtractedResource>();
  for (const raw of CURATED_URLS) {
    const resource = classifyUrl(normalize(raw));
    if (!resource) continue;
    const key = resource.url.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, resource);
  }
  return Array.from(byKey.values()).sort((a, b) => (a.name ?? a.url).localeCompare(b.name ?? b.url));
})();
