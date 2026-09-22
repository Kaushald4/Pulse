import type { AppConfig, ProbeResult } from "./types";

export const isTauriEnv = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const EMPTY_CONFIG: AppConfig = {
  macosWidgetEnabled: true,
  cloudflare: { accountId: "", apiToken: "" },
  openrouter: { apiKey: "" },
  openaiCompatible: { baseUrl: "", apiKey: "" },
  classification: { provider: "cloudflare", model: "typesafe/jev", engine: "jev" },
  generation: {
    provider: "cloudflare",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    engine: "llm",
  },
  extraction: {
    engine: "builtin",
    tinyfishApiKey: "",
    pythonPath: "",
  },
  // Jobs default to the free built-in engine, so scanning listings never spends
  // the article reader's TinyFish allowance.
  jobsExtraction: { engine: "builtin" },
  githubToken: "",
};

export async function getConfig(): Promise<AppConfig> {
  if (!isTauriEnv()) return { ...EMPTY_CONFIG };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const config = await invoke<Partial<AppConfig>>("get_config");
    return { ...EMPTY_CONFIG, ...config };
  } catch (err) {
    console.warn("[Pulse] Could not read config:", err);
    return { ...EMPTY_CONFIG };
  }
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  if (!isTauriEnv()) return config;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppConfig>("set_config", { config });
}

export interface WidgetSnapshotItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

/** Publishes the small, non-sensitive snapshot consumed by the native widget. */
export async function publishWidgetSnapshot(items: WidgetSnapshotItem[], enabled = true): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("publish_widget_snapshot", {
      snapshot: JSON.stringify({ enabled, generatedAt: new Date().toISOString(), items }),
    });
  } catch (err) {
    console.warn("[Pulse] Could not publish widget snapshot:", err);
  }
}

export async function testConnection(): Promise<{
  classification: ProbeResult | null;
  generation: ProbeResult | null;
  error?: string;
}> {
  if (!isTauriEnv()) {
    return { classification: null, generation: null, error: "Desktop app required." };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{
      classification?: ProbeResult;
      generation?: ProbeResult;
    }>("test_connection");
    return {
      classification: result?.classification ?? null,
      generation: result?.generation ?? null,
    };
  } catch (err) {
    return {
      classification: null,
      generation: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface HelmsmanStatus {
  path: string | null;
  version: string | null;
  node: boolean;
  managed: boolean;
}

export const EMPTY_HELMSMAN_STATUS: HelmsmanStatus = {
  path: null,
  version: null,
  node: false,
  managed: false,
};

export async function getHelmsmanStatus(): Promise<HelmsmanStatus> {
  if (!isTauriEnv()) return { ...EMPTY_HELMSMAN_STATUS };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<Partial<HelmsmanStatus>>("helmsman_status");
    return { ...EMPTY_HELMSMAN_STATUS, ...result };
  } catch {
    return { ...EMPTY_HELMSMAN_STATUS };
  }
}

export interface InstallResult {
  path: string;
  version: string | null;
  asset: string;
  node: boolean;
}

/** Downloads the latest published helmsman bundle into ~/.pulse/helmsman. */
export async function installHelmsman(): Promise<InstallResult> {
  if (!isTauriEnv()) {
    throw new Error("Installing helmsman requires the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<InstallResult>("install_helmsman");
}

export async function getAppVersion(): Promise<string | null> {
  if (!isTauriEnv()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("get_app_version");
  } catch {
    return null;
  }
}

/** Opens a URL in the OS browser when running natively, else a new tab. */
export async function openExternal(url: string): Promise<void> {
  if (isTauriEnv()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (err) {
      console.warn("[Pulse] Could not open URL natively:", err);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
