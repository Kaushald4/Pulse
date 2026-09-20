/**
 * The bridge to helmsman, the CLI that owns the browser profiles and does the
 * reading. Everything that shells out to it goes through here.
 */
import { isTauriEnv } from "../config";

export async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import("@tauri-apps/api/core");
  return call<T>(command, args);
}

export function requireDesktop(): void {
  if (!isTauriEnv()) {
    throw new Error("Sync requires the desktop app. Run `pnpm tauri dev` instead of the browser preview.");
  }
}

/** Runs one helmsman capability and returns its rows. Also used by job sources. */
export async function runHelmsman(command: string, args: string[]): Promise<any[]> {
  const result = await invoke<unknown>("run_helmsman_extract", { command, args });
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") return [result];
  return [];
}

/** Whether the Chrome profile directory exists. NOT proof that a login happened. */
export async function profileExists(profileName: string): Promise<boolean> {
  if (!isTauriEnv()) return false;
  try {
    return await invoke<boolean>("check_profile_status", { profile: profileName });
  } catch {
    return false;
  }
}

export async function launchAuthLogin(profileName: string, siteDomain: string): Promise<string> {
  if (!isTauriEnv()) {
    window.open(`https://${siteDomain}`, "_blank");
    return `Opened https://${siteDomain} in the browser.`;
  }
  return invoke<string>("launch_auth_login", { profile: profileName, site: siteDomain });
}

/** Deletes the saved Chrome profile for a source, signing it out for real. */
export async function disconnectProfile(
  profileName: string
): Promise<{ removed: boolean; path: string }> {
  if (!isTauriEnv()) {
    throw new Error("Disconnecting requires the desktop app.");
  }
  return invoke<{ removed: boolean; path: string }>("disconnect_profile", { profile: profileName });
}
