"use client";

/**
 * Self-updating.
 *
 * The Rust side does the work (checking the release manifest, verifying the
 * signature against the pubkey in `tauri.conf.json`, installing). This module is
 * the policy: when to check, what Skip means, and what the UI is told.
 *
 * Two constraints shape it:
 *  - A failed check is not an error the user needs to see. Offline, no published
 *    release, or a manifest that has not been written yet are all normal, so
 *    everything here resolves rather than throwing.
 *  - "Skip" remembers the version, so the same update does not reappear on every
 *    launch. A newer one still will.
 */
import { isTauriEnv } from "./config";

const SKIPPED_KEY = "pulse-skipped-update";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  /** The release notes the manifest carried, if any. */
  notes: string | null;
  date: string | null;
}

/** The version the user chose to skip, if any. */
export function skippedVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SKIPPED_KEY);
  } catch {
    return null;
  }
}

export function skipVersion(version: string): void {
  try {
    window.localStorage.setItem(SKIPPED_KEY, version);
  } catch {
    // Private mode: the skip just will not persist, which is survivable.
  }
}

export function clearSkippedVersion(): void {
  try {
    window.localStorage.removeItem(SKIPPED_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Returns the update worth offering, or null.
 *
 * Null covers every uninteresting case: not the desktop app, nothing published,
 * already on the newest version, or a version the user skipped.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauriEnv()) return null;

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    // `downloadAndInstall` can run long; give the check room on a slow link.
    const update = await check({ timeout: 30000 });

    if (!update) {
      // Nothing newer exists, so a previous skip is stale.
      clearSkippedVersion();
      return null;
    }
    if (update.version === skippedVersion()) return null;

    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body?.trim() || null,
      date: update.date ?? null,
    };
  } catch (error) {
    // Offline, a draft-only release, or a malformed manifest all land here.
    console.warn("[Pulse] Update check failed:", error);
    return null;
  }
}

export interface InstallProgress {
  /** 0 to 1, or null while the total size is still unknown. */
  fraction: number | null;
  downloadedBytes: number;
}

/**
 * Downloads and installs the update, then restarts into it.
 *
 * On Windows the installer exits the app itself, so `relaunch` is only reached
 * on macOS. Calling it there is required: without it the user keeps looking at
 * the old process until they quit and reopen.
 */
export async function installUpdate(
  onProgress?: (progress: InstallProgress) => void
): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 30000 });
  if (!update) throw new Error("That update is no longer available.");

  let total: number | null = null;
  let downloaded = 0;

  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      downloaded = 0;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    }
    onProgress?.({
      fraction: total && total > 0 ? Math.min(1, downloaded / total) : null,
      downloadedBytes: downloaded,
    });
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
