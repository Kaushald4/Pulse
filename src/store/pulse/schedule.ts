/**
 * The scheduled sync.
 *
 * The timer itself lives in Rust; this only records what it reports, so the two
 * cannot disagree about when the next run is.
 */
import type { StateCreator } from "zustand";
import { saveSchedule } from "../../lib/db/personal";
import { configureSchedule, toIso } from "../../lib/schedule";
import type { PulseStore, ScheduleSlice } from "./types";

export const createScheduleSlice: StateCreator<PulseStore, [], [], ScheduleSlice> = (set, get) => ({
  schedule: { id: "default", enabled: false, intervalMinutes: 360, notify: true },

  updateSchedule: async (schedule) => {
    // Ask the timer what it will do, and store that. Computing the next run here
    // is what used to leave Settings showing a time that had already passed.
    const status = await configureSchedule(schedule);
    const stored = status ? { ...schedule, nextRunAt: toIso(status.nextRunAt) } : schedule;
    await saveSchedule(stored);
    set({ schedule: stored });
  },

  reportScheduleRun: async (due, ran) => {
    const schedule = {
      ...get().schedule,
      nextRunAt: toIso(due.nextRunAt),
      ...(ran ? { lastRunAt: toIso(due.firedAt) } : {}),
    };
    await saveSchedule(schedule);
    set({ schedule });
  },
});
