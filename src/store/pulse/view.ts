/**
 * What the app is showing: the view, the filters, the selection and the overlays.
 */
import type { StateCreator } from "zustand";
import { DEFAULT_FILTERS, FEED_PAGE_SIZE, type PulseStore, type ViewSlice } from "./types";

export const createViewSlice: StateCreator<PulseStore, [], [], ViewSlice> = (set, get) => ({
  view: "today",
  filters: { ...DEFAULT_FILTERS },
  selectedItemId: null,
  drawerOpen: false,
  paletteOpen: false,

  setView: (view) => set({ view, selectedItemId: null }),

  // Another set of filters is another list, so the paging starts over.
  setFilter: (patch) => {
    set((state) => ({ filters: { ...state.filters, ...patch }, feedLimit: FEED_PAGE_SIZE }));
    void get().refreshItems();
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS }, feedLimit: FEED_PAGE_SIZE });
    void get().refreshItems();
  },

  selectItem: (id) => set({ selectedItemId: id }),
  openDrawer: (id) => set({ drawerOpen: true, selectedItemId: id ?? get().selectedItemId }),
  closeDrawer: () => set({ drawerOpen: false }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
});
