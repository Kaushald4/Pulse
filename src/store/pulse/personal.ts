/**
 * Preferences, watchlists and projects: what the reader has taught Pulse, and
 * what they are working on.
 */
import type { StateCreator } from "zustand";
import {
  clearSignalPreferences,
  createProject,
  createWatchlist,
  deleteProject,
  deleteSignalPreference,
  deleteWatchlist,
  saveProject,
  saveWatchlist,
} from "../../lib/db/personal";
import type { PersonalSlice, PulseStore } from "./types";

export const createPersonalSlice: StateCreator<PulseStore, [], [], PersonalSlice> = (set, get) => ({
  preferences: [],
  watchlists: [],
  projects: [],

  addWatchlist: async (name, query) => {
    const watchlist = createWatchlist(name, query);
    if (!watchlist.name || !watchlist.query) return;
    await saveWatchlist(watchlist);
    await get().refresh();
  },

  removeWatchlist: async (id) => {
    await deleteWatchlist(id);
    await get().refresh();
  },

  removePreference: async (id) => {
    await deleteSignalPreference(id);
    await get().refresh();
  },

  clearPreferences: async () => {
    await clearSignalPreferences();
    await get().refresh();
  },

  addProject: async (name, description) => {
    const project = createProject(name, description);
    if (!project.name) return;
    await saveProject(project);
    await get().refresh();
  },

  removeProject: async (id) => {
    await deleteProject(id);
    await get().refresh();
  },

  saveProject: async (project) => {
    await saveProject(project);
    await get().refresh();
  },
});
