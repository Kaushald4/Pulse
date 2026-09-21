"use client";

/**
 * The tray icon's busy state.
 *
 * Rust owns the icon; this only tells it when a sync starts and stops. Driven by
 * a subscription to the store rather than by each caller, so "Sync all", a
 * domain group, a single source and the tray's own "Sync now" are all covered by
 * the one hook.
 */
import { isTauriEnv } from "./config";

export async function setTraySyncing(syncing: boolean): Promise<void> {
  if (!isTauriEnv()) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_tray_syncing", { syncing });
  } catch (error) {
    // A tray that cannot be repainted is not worth failing a sync over.
    console.warn("[Pulse] Could not update the tray icon:", error);
  }
}
