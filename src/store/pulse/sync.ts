/**
 * Collecting: the sources, the sync runs, and the log of what happened.
 */
import type { StateCreator } from "zustand";
import { getRuns } from "../../lib/db/runs";
import { getSources, saveSources } from "../../lib/db/sources";
import { fetchResourcePreviews } from "../../lib/metadata";
import { syncSources } from "../../lib/pipeline";
import { canSync, partitionSyncable } from "../../lib/sources/auth";
import { describeOptions } from "../../lib/sources/describe";
import {
  closeProfileBrowser,
  disconnectProfile,
  launchAuthLogin,
  profileExists,
} from "../../lib/sources/helmsman";
import { toast } from "../../lib/toast";
import type { SourceConnection } from "../../lib/types";
import type { PulseStore, SyncSlice } from "./types";

/**
 * The shared sync path: skips unconnected sources, records progress, and
 * reports one toast for the whole run. Used by "Sync all" and by a domain
 * group's "Sync all N".
 */
async function runSync(
  get: () => PulseStore,
  set: (partial: Partial<PulseStore>) => void,
  targets: SourceConnection[]
): Promise<void> {
  if (!get().desktop) {
    toast.error("Sync needs the desktop app", "Run `pnpm tauri dev` instead of the browser preview.");
    return;
  }
  if (get().syncing) return;

  set({ syncing: true, syncProgress: null });
  try {
    const enabled = targets.filter((source) => source.enabled !== false);
    const { ready, skipped } = partitionSyncable(enabled);

    if (ready.length === 0) {
      toast.info("Nothing to sync", "Connect a source in Sources, then try again.");
      return;
    }

    const report = await syncSources(ready, (progress) =>
      set({ syncProgress: progress, syncingSource: progress.id })
    );
    const failures = report.outcomes.filter((outcome) => !outcome.ok);

    const parts = [`${report.newItems} items`, `${report.classified} classified`];
    if (report.previews > 0) parts.push(`${report.previews} previews`);
    if (skipped.length) parts.push(`${skipped.length} skipped (no saved login)`);

    if (failures.length === 0) {
      toast.success("Sync complete", parts.join(" · "));
    } else {
      toast.error(
        `Sync finished with ${failures.length} error${failures.length > 1 ? "s" : ""}`,
        `${parts.join(" · ")}. ${failures[0].error ?? ""}`
      );
    }

    await get().refreshSources();
    // Resource cards are links mentioned inside items, and nothing had ever
    // fetched a preview for those, so cover a bounded batch before the reload
    // below picks the results up.
    await fetchResourcePreviews(get().resources.map((entry) => entry.resource.url));
    await get().refresh();
    // The run log is its own table - it must be re-read or it keeps showing
    // whatever it held when the app started.
    await get().refreshRuns();
  } catch (err) {
    toast.error("Sync failed", err instanceof Error ? err.message : String(err));
  } finally {
    set({ syncing: false, syncProgress: null, syncingSource: null });
  }
}

export const createSyncSlice: StateCreator<PulseStore, [], [], SyncSlice> = (set, get) => ({
  sources: [],
  syncing: false,
  syncProgress: null,
  syncingSource: null,
  pendingLoginSourceId: null,
  runs: [],
  lastSyncedAt: null,

  refreshSources: async () => {
    const sources = await getSources();
    const updated = await Promise.all(
      sources.map(async (source) => {
        if (source.authType !== "browser_profile" || !source.profileName) return source;
        // Directory existence only tells us Chrome ran once - it is not proof of
        // a login, so it never sets isConnected.
        const exists = await profileExists(source.profileName);
        return { ...source, profileExists: exists };
      })
    );
    set({ sources: updated });
    await saveSources(updated);
  },

  refreshRuns: async () => {
    const runs = await getRuns(300);
    // Runs arrive newest-first, so the first finished sync is the latest one.
    const lastSyncedAt =
      runs.find((run) => run.category === "sync" && run.status === "success")?.finishedAt ?? null;
    set({ runs, lastSyncedAt });
  },

  syncAll: async () => {
    await runSync(get, set, get().sources);
  },

  syncGroup: async (sourceIds) => {
    await runSync(
      get,
      set,
      get().sources.filter((source) => sourceIds.includes(source.id))
    );
  },

  syncOne: async (sourceId) => {
    if (!get().desktop) {
      toast.error("Sync needs the desktop app", "Run `pnpm tauri dev` instead of the browser preview.");
      return;
    }
    // Prefer the row id: several sources share one `source` value (arXiv's
    // categories, Hacker News feed + search), so matching on it alone would
    // sync the wrong one.
    const source =
      get().sources.find((entry) => entry.id === sourceId) ??
      get().sources.find((entry) => entry.source === sourceId);
    if (!source) return;

    set({ syncing: true, syncProgress: null, syncingSource: source.id });
    try {
      const report = await syncSources([source]);
      const outcome = report.outcomes[0];
      if (outcome?.ok) {
        toast.success(`${source.name} synced`, `${outcome.newCount} items · ${report.classified} classified`);
      } else {
        toast.error(`${source.name} failed`, outcome?.error ?? "Unknown error");
      }
      await get().refreshSources();
      await get().refresh();
      await get().refreshRuns();
      if (report.newItems > 0) {
        await get().regenerateBriefing();
      }
    } finally {
      set({ syncing: false, syncProgress: null, syncingSource: null });
    }
  },

  connectSource: async (source) => {
    if (!source.profileName || !source.siteDomain) return;
    try {
      await launchAuthLogin(source.profileName, source.siteDomain);
      set({ pendingLoginSourceId: source.id });
      toast.info(`Sign in to ${source.name}`, "Use the Chrome window, then press I've signed in here.");
    } catch (err) {
      toast.error("Could not open login", err instanceof Error ? err.message : String(err));
    }
  },

  cancelConnect: () => set({ pendingLoginSourceId: null }),

  /**
   * The user says the sign-in is finished.
   *
   * Closing the login window comes first, because on macOS a closed Chrome
   * window leaves the browser running and the profile locked, and the sync below
   * cannot open a locked profile. That sync then decides the outcome: a saved
   * profile only means a browser ran, so a source counts as connected only once
   * a sync against it has actually succeeded.
   */
  finishConnect: async (source) => {
    set({ pendingLoginSourceId: null });
    try {
      if (source.profileName) await closeProfileBrowser(source.profileName);
    } catch (err) {
      toast.error("Could not close the login window", err instanceof Error ? err.message : String(err));
      return;
    }

    await get().refreshSources();
    const fresh = get().sources.find((entry) => entry.id === source.id);
    if (!fresh) return;
    if (!canSync(fresh)) {
      toast.error("No login was saved", `Press Connect and sign in to ${source.name} again.`);
      return;
    }

    toast.info(`Checking ${source.name}`, "Running a sync to confirm the saved login works.");
    await get().syncOne(fresh.id);
  },

  disconnectSource: async (source) => {
    if (!source.profileName) return;
    try {
      const result = await disconnectProfile(source.profileName);
      const next = get().sources.map((entry) =>
        entry.id === source.id
          ? { ...entry, isConnected: false, profileExists: false, lastError: undefined }
          : entry
      );
      set({ sources: next });
      if (get().pendingLoginSourceId === source.id) set({ pendingLoginSourceId: null });
      await saveSources(next);
      toast.success(
        `${source.name} disconnected`,
        result.removed ? "The saved browser profile was deleted." : "No saved profile was found."
      );
    } catch (err) {
      toast.error("Could not disconnect", err instanceof Error ? err.message : String(err));
    }
  },

  updateSourceOptions: async (sourceId, options) => {
    // Match on the unique row id when we have one, so editing one arXiv
    // category cannot rewrite the others.
    const byId = get().sources.some((source) => source.id === sourceId);
    const matches = (source: SourceConnection) =>
      byId ? source.id === sourceId : source.source === sourceId;

    const next = get().sources.map((source) =>
      matches(source)
        ? { ...source, options, monitoredChannels: describeOptions({ ...source, options }) }
        : source
    );
    set({ sources: next });
    await saveSources(next);
    toast.success("Source settings saved");
  },
});
