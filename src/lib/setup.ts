/**
 * First-run setup, from the window's side.
 *
 * The installer runs in Rust (it has to download and unpack things); this module
 * asks what is missing and forwards the streamed lines back to the UI.
 */
import { isTauriEnv } from "./config";

export interface SetupStep {
  id: string;
  title: string;
  detail: string;
  required: boolean;
  /** Where a human has to install it, when Pulse cannot. */
  manual: string | null;
  ready: boolean;
  version: string | null;
}

export interface SetupStatus {
  complete: boolean;
  missingRequired: boolean;
  venv: boolean;
  steps: SetupStep[];
}

export type SetupPhase = "start" | "line" | "done" | "failed" | "skip";

export interface SetupProgress {
  step: string;
  status: SetupPhase;
  text: string;
}

export interface SetupResult {
  blocked: boolean;
  results: Array<{
    id: string;
    status: "ready" | "installed" | "failed";
    required: boolean;
    error?: string;
  }>;
}

/**
 * The browser preview has no Rust side, so it is never gated behind an
 * installer that could not possibly run there.
 */
const PREVIEW: SetupStatus = { complete: true, missingRequired: false, venv: false, steps: [] };

export async function getSetupStatus(): Promise<SetupStatus> {
  if (!isTauriEnv()) return PREVIEW;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SetupStatus>("setup_status");
}

/** Runs every missing component, reporting each line as it happens. */
export async function runSetup(onProgress: (progress: SetupProgress) => void): Promise<SetupResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const unlisten = await listen<SetupProgress>("setup-progress", (event) => onProgress(event.payload));
  try {
    return await invoke<SetupResult>("run_setup");
  } finally {
    unlisten();
  }
}

/** Records that the user chose to move on, so the wizard does not return. */
export async function dismissSetup(): Promise<void> {
  if (!isTauriEnv()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("dismiss_setup");
}
