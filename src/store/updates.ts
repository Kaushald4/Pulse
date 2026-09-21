"use client";

/**
 * Update state.
 *
 * Two entry points drive the same flow: the check on launch, which prompts, and
 * the button in Settings, which reports inline. Keeping the state here means the
 * install path exists once and the two views cannot disagree about what is
 * available.
 */
import { create } from "zustand";
import {
  checkForUpdate,
  installUpdate,
  skipVersion,
  type AvailableUpdate,
  type InstallProgress,
} from "../lib/updater";

export type UpdateStatus = "idle" | "checking" | "available" | "latest" | "failed";

interface UpdateStore {
  status: UpdateStatus;
  update: AvailableUpdate | null;
  /** True while the download and install are running. */
  installing: boolean;
  progress: InstallProgress | null;
  error: string | null;
  /** Whether the launch dialog is showing. */
  promptOpen: boolean;

  /** Checks once. `prompt` opens the dialog when something is found. */
  check: (options?: { prompt?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  /** Records the version and closes the prompt. */
  skip: () => void;
  /** Closes the prompt without recording anything. */
  dismiss: () => void;
}

export const useUpdates = create<UpdateStore>((set, get) => ({
  status: "idle",
  update: null,
  installing: false,
  progress: null,
  error: null,
  promptOpen: false,

  check: async ({ prompt = false } = {}) => {
    if (get().installing) return;

    set({ status: "checking", error: null });
    const found = await checkForUpdate();

    if (found) {
      set({ status: "available", update: found, promptOpen: prompt });
    } else {
      set({ status: "latest", update: null, promptOpen: false });
    }
  },

  install: async () => {
    if (get().installing) return;

    set({ installing: true, error: null, progress: null });
    try {
      await installUpdate((progress) => set({ progress }));
      // macOS restarts into the new build here. On Windows the installer exits
      // the process first, so this is not reached.
    } catch (err) {
      set({
        installing: false,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  skip: () => {
    const { update } = get();
    if (update) skipVersion(update.version);
    set({ promptOpen: false, status: "idle", update: null });
  },

  dismiss: () => set({ promptOpen: false }),
}));
