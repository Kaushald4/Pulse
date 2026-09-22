/**
 * What the app is showing: the view, the filters, the selection and the overlays.
 */
import type { StateCreator } from "zustand";
import { DEFAULT_FILTERS, type PulseStore, type ViewSlice } from "./types";

export const createViewSlice: StateCreator<PulseStore, [], [], ViewSlice> = (set, get) => ({
  view: "today",
  filters: { ...DEFAULT_FILTERS },
  selectedItemId: null,
  drawerOpen: false,
  paletteOpen: false,

  setView: (view) => set({ view, selectedItemId: null }),

  setFilter: (patch) => {
    set((state) => ({ filters: { ...state.filters, ...patch } }));
    void get().refreshItems();
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    void get().refreshItems();
  },

  selectItem: (id) => set({ selectedItemId: id }),
  openDrawer: (id) => set({ drawerOpen: true, selectedItemId: id ?? get().selectedItemId }),
  closeDrawer: () => set({ drawerOpen: false }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
});
