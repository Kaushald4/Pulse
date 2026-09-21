"use client";

/**
 * The scheduled sync timer, which lives in Rust.
 *
 * The timer owns when the next run happens and this module only asks it. Working
 * the time out on this side is what broke the Settings display before: a time
 * computed here is a guess that goes stale the moment the timer fires, whereas
 * the timer always knows when it last ran and how long it is waiting.
 */
import { isTauriEnv } from "./config";
import type { PulseSchedule } from "./types";

export interface SchedulerStatus {
  enabled: boolean;
  intervalMinutes: number;
  /** Epoch milliseconds, or null when nothing is scheduled. */
  nextRunAt: number | null;
  /** Epoch milliseconds of the last run the timer fired. */
  lastRunAt: number | null;
}

/** The payload of the `background-sync-due` event. */
export interface ScheduleDue {
  firedAt: number;
  nextRunAt: number;
}

/** Epoch milliseconds to the ISO string the database stores. */
export function toIso(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

/** Points the timer at a schedule, and reports what it will actually do. */
export async function configureSchedule(
  schedule: PulseSchedule,
): Promise<SchedulerStatus | null> {
  if (!isTauriEnv()) return null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SchedulerStatus>("configure_background_scheduler", {
      config: {
        enabled: schedule.enabled,
        intervalMinutes: schedule.intervalMinutes,
        lastRunAt: schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : null,
      },
    });
  } catch (error) {
    // A schedule that cannot be armed is worth telling the user about, but it is
    // not worth taking the whole settings screen down for.
    console.warn("[Pulse] Could not configure the sync schedule:", error);
    return null;
  }
}

/** Asks the timer what it is doing, without changing it. */
export async function scheduleStatus(): Promise<SchedulerStatus | null> {
  if (!isTauriEnv()) return null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SchedulerStatus>("background_schedule_status");
  } catch {
    return null;
  }
}
