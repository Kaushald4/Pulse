/**
 * The app's store, composed from one slice per concern.
 *
 * Slices are plain factories over the shared state, so an action in one slice
 * can call an action in another through `get()`. Importers keep using
 * `../store/pulse`, which resolves here.
 */
import { create } from "zustand";
import { createBootstrapSlice } from "./bootstrap";
import { createItemsSlice } from "./items";
import { createPersonalSlice } from "./personal";
import { createScheduleSlice } from "./schedule";
import { createSettingsSlice } from "./settings";
import { createSyncSlice } from "./sync";
import { createViewSlice } from "./view";
import type { PulseStore } from "./types";

export const usePulse = create<PulseStore>()((...args) => ({
  ...createBootstrapSlice(...args),
  ...createItemsSlice(...args),
  ...createViewSlice(...args),
  ...createSyncSlice(...args),
  ...createPersonalSlice(...args),
  ...createScheduleSlice(...args),
  ...createSettingsSlice(...args),
}));

export { DEFAULT_FILTERS, toQuery } from "./types";
export type { Filters, NavigationTab, PulseStore } from "./types";
