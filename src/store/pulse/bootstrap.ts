/**
 * Startup.
 *
 * Reads the stored settings, arms the sync timer, then loads the library. The
 * order matters: nothing here awaits the network before `ready` is set.
 */
import type { StateCreator } from "zustand";
import { getConfig, isTauriEnv, publishWidgetSnapshot } from "../../lib/config";
import { getStorageStatus } from "../../lib/db/client";
import {
  getProjects,
  getSchedule,
  getSignalPreferences,
  getWatchlists,
  saveSchedule,
} from "../../lib/db/personal";
import { getSources } from "../../lib/db/sources";
import { configureSchedule, toIso } from "../../lib/schedule";
import { toast } from "../../lib/toast";
import type { BootstrapSlice, PulseStore } from "./types";

export const createBootstrapSlice: StateCreator<PulseStore, [], [], BootstrapSlice> = (set, get) => ({
  ready: false,
  desktop: false,

  init: async () => {
    const desktop = isTauriEnv();
    set({ desktop });

    const [config, sources, preferences, watchlists, projects, stored] = await Promise.all([
      getConfig(),
      getSources(),
      getSignalPreferences(),
      getWatchlists(),
      getProjects(),
      getSchedule(),
    ]);

    // Arming the timer also returns when it will next run, which is the only
    // trustworthy answer: it knows when it last fired and how long it then waited.
    const status = await configureSchedule(stored);
    const schedule = status ? { ...stored, nextRunAt: toIso(status.nextRunAt) } : stored;
    if (status) await saveSchedule(schedule);

    set({ config, sources, preferences, watchlists, projects, schedule });
    // Establish the shared App Group file immediately. This also lets the
    // widget leave its placeholder state before the first sync finishes.
    void publishWidgetSnapshot([], config.macosWidgetEnabled);

    await get().refresh();
    await get().refreshSources();
    await get().refreshRuns();
    set({ ready: true });

    // Falling back to browser storage is silent and fragile, and a silent fallback
    // is how the app spent weeks running on localStorage without anyone noticing.
    // Say it out loud instead.
    const storage = getStorageStatus();
    if (desktop && storage.mode === "browser") {
      toast.error(
        "Running on browser storage, not SQLite",
        "Pulse could not open its database, so your library is in the browser store for now. See Settings, About."
      );
    }

    // Rich previews for the curated catalog are fetched once and persisted, so
    // they are not awaited - the UI is usable while they stream in.
    void get().refreshPreviews();
  },
});
