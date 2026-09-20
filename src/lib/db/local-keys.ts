/**
 * localStorage keys for the browser fallback - one per stored collection.
 *
 * Central so a key is never typo'd into a second, silently empty collection.
 * Job storage keys live in `jobs-common.ts` with the job row mappers.
 */

export const LS_ITEMS = "pulse_items_v4";
export const LS_META = "pulse_meta_v1";
export const LS_BRIEFINGS = "pulse_briefings_v1";
export const LS_SOURCES = "pulse_sources_v1";
export const LS_RUNS = "pulse_runs_v1";
export const LS_LINK_PREVIEWS = "pulse_link_previews_v1";
export const LS_PREFERENCES = "pulse_preferences_v1";
export const LS_WATCHLISTS = "pulse_watchlists_v1";
export const LS_PROJECTS = "pulse_projects_v1";
export const LS_SCHEDULE = "pulse_schedule_v1";
