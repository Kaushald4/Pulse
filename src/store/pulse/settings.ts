/**
 * Settings, and the whole-library operations that sit beside them.
 */
import type { StateCreator } from "zustand";
import { EMPTY_CONFIG, publishWidgetSnapshot, saveConfig as persistConfig } from "../../lib/config";
import { clearAllData, loadDemoData } from "../../lib/db/maintenance";
import {
  buildLibraryExport,
  importLibrary as applyLibraryFile,
  pickLibraryFile,
  saveLibraryFile,
} from "../../lib/library";
import { toast } from "../../lib/toast";
import { useJobs } from "../jobs";
import type { PulseStore, SettingsSlice } from "./types";

export const createSettingsSlice: StateCreator<PulseStore, [], [], SettingsSlice> = (set, get) => ({
  config: { ...EMPTY_CONFIG },

  updateConfig: async (config) => {
    try {
      const saved = await persistConfig(config);
      set({ config: saved });
      if (!saved.macosWidgetEnabled) {
        await publishWidgetSnapshot([], false);
      }
      toast.success("Settings saved");
    } catch (err) {
      toast.error("Could not save settings", err instanceof Error ? err.message : String(err));
    }
  },

  loadDemo: async () => {
    const count = await loadDemoData();
    await get().refresh();
    toast.success("Demo data loaded", `${count} sample items added.`);
  },

  wipeData: async () => {
    await clearAllData();
    await get().refresh();
    // The job hunt lives in its own store, so it goes on showing listings that
    // no longer exist until it is told to reload: a reset that leaves one
    // screen full of ghosts is not a reset.
    const jobs = useJobs.getState();
    jobs.closeJob();
    await jobs.refresh();
    toast.success("Local library cleared");
  },

  exportLibrary: async () => {
    if (!get().desktop) {
      toast.error("Export needs the desktop app");
      return;
    }
    try {
      const payload = await buildLibraryExport();
      const path = await saveLibraryFile(JSON.stringify(payload, null, 2));
      if (!path) return;
      toast.success("Library exported", `${payload.items.length} items written to ${path}`);
    } catch (err) {
      toast.error("Export failed", err instanceof Error ? err.message : String(err));
    }
  },

  importLibrary: async () => {
    if (!get().desktop) {
      toast.error("Import needs the desktop app");
      return;
    }
    try {
      const raw = await pickLibraryFile();
      if (!raw) return;
      const summary = await applyLibraryFile(raw);
      await get().refresh();
      await get().refreshSources();
      toast.success(
        "Library imported",
        `${summary.items} items · ${summary.sources} sources · ${summary.briefings} briefings` +
          (summary.skipped > 0 ? ` · ${summary.skipped} skipped` : "")
      );
    } catch (err) {
      toast.error("Import failed", err instanceof Error ? err.message : String(err));
    }
  },
});
