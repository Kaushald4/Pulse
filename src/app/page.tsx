"use client";

import React from "react";
import { Sidebar } from "../components/sidebar";
import { Header } from "../components/header";
import { DashboardView } from "../components/dashboard-view";
import { FeedView } from "../components/feed/feed-view";
import { ResourcesView } from "../components/resources-view";
import { JobsView } from "../components/jobs/jobs-view";
import { JobDetailView } from "../components/jobs/job-detail-view";
import { SourcesView } from "../components/sources-view";
import { LogsView } from "../components/logs-view";
import { SettingsView } from "../components/settings-view";
import { ReaderDrawer } from "../components/reader-drawer";
import { CommandPalette } from "../components/command-palette";
import { InstallerView } from "../components/installer/installer-view";
import { usePulse } from "../store/pulse";
import { useJobs } from "../store/jobs";
import { openExternal } from "../lib/config";
import { getSetupStatus, type SetupStatus } from "../lib/setup";
import { setTraySyncing } from "../lib/tray";
import { type ScheduleDue } from "../lib/schedule";
import { UpdateNotice } from "../components/update-notice";

export default function PulseApp() {
  const ready = usePulse((state) => state.ready);
  const view = usePulse((state) => state.view);
  const items = usePulse((state) => state.items);
  const selectedItemId = usePulse((state) => state.selectedItemId);
  const drawerOpen = usePulse((state) => state.drawerOpen);
  const init = usePulse((state) => state.init);
  const selectItem = usePulse((state) => state.selectItem);
  const openDrawer = usePulse((state) => state.openDrawer);
  const closeDrawer = usePulse((state) => state.closeDrawer);
  const setPaletteOpen = usePulse((state) => state.setPaletteOpen);
  const paletteOpen = usePulse((state) => state.paletteOpen);
  const toggleState = usePulse((state) => state.toggleState);
  const selectedJobId = useJobs((state) => state.selectedJobId);

  /** Null while the app is still asking; the installer runs before anything else. */
  const [setup, setSetup] = React.useState<SetupStatus | null>(null);

  React.useEffect(() => {
    void getSetupStatus().then(setSetup);
  }, []);

  React.useEffect(() => {
    // Nothing loads until setup is out of the way - that is the point of it.
    if (!setup?.complete) return;
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup?.complete]);

  /**
   * Mirrors the sync state onto the tray icon.
   *
   * A subscription rather than a call at each sync site, so every path - "Sync
   * all", a group, one source, or the tray's own "Sync now" - is covered,
   * including ones added later.
   */
  React.useEffect(() => {
    if (!ready) return;
    return usePulse.subscribe((state, previous) => {
      if (state.syncing !== previous.syncing) void setTraySyncing(state.syncing);
    });
  }, [ready]);

  React.useEffect(() => {
    if (!ready || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: Array<() => void> = [];
    void import("@tauri-apps/api/event").then(({ listen }) =>
      Promise.all([
        listen("tray-sync-request", () => void usePulse.getState().syncAll()),
        listen<string>("profile-login-finished", async (event) => {
          const state = usePulse.getState();
          const profile = event.payload;
          const pending = state.sources.find((entry) => entry.id === state.pendingLoginSourceId);

          // Rust reports this when the login browser exits by itself, which is
          // what happens if the user quits Chrome rather than just closing its
          // window. That is the same end state the finish button produces, so it
          // finishes the flow too, instead of asking for a click nobody needs.
          if (pending && pending.profileName === profile) {
            await state.finishConnect(pending);
            return;
          }

          // Any other exit just means a profile may have changed, so the screen
          // should re-read it rather than keep showing a stale connection state.
          await state.refreshSources();
        }),
        listen<ScheduleDue>("background-sync-due", async (event) => {
          const due = event.payload;
          const current = usePulse.getState();
          if (!current.schedule.enabled) return;

          // A sync already running is already collecting the same sources, so this
          // firing is covered by it. The timer has moved on regardless, and its
          // next run has to be recorded either way or Settings shows a past time.
          if (current.syncing) {
            await current.reportScheduleRun(due, false);
            return;
          }

          await current.syncAll();
          await usePulse.getState().reportScheduleRun(due, true);

          if (current.schedule.notify) {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("send_notification", {
              title: "Pulse sync complete",
              body: "Your signal desk has fresh items to review.",
            });
          }
        }),
      ]).then((cleanups) => {
        unlisten = cleanups;
      })
    );
    return () => unlisten.forEach((cleanup) => cleanup());
  }, [ready]);

  // Global keyboard shortcuts, mirroring the reading-queue workflow.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }

      if (event.key === "Escape") {
        if (drawerOpen) closeDrawer();
        else if (paletteOpen) setPaletteOpen(false);
        return;
      }

      if (typing || paletteOpen || items.length === 0) return;

      const currentIndex = items.findIndex((item) => item.id === selectedItemId);
      const selected = currentIndex >= 0 ? items[currentIndex] : null;

      if (event.key === "j") {
        event.preventDefault();
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        selectItem(items[next].id);
      } else if (event.key === "k") {
        event.preventDefault();
        const previous = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        selectItem(items[previous].id);
      } else if (event.key === "s" && selected) {
        event.preventDefault();
        void toggleState(selected.id, "saved");
      } else if (event.key === "i" && selected) {
        event.preventDefault();
        void toggleState(selected.id, "important");
      } else if (event.key === "a" && selected) {
        event.preventDefault();
        void toggleState(selected.id, "archived");
      } else if (event.key === "o" && selected) {
        event.preventDefault();
        void openExternal(selected.url);
      } else if ((event.key === "Enter" || event.key === " ") && selected && !drawerOpen) {
        event.preventDefault();
        openDrawer(selected.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    items,
    selectedItemId,
    drawerOpen,
    paletteOpen,
    selectItem,
    openDrawer,
    closeDrawer,
    setPaletteOpen,
    toggleState,
  ]);

  if (setup && !setup.complete) {
    return <InstallerView status={setup} onDone={() => setSetup({ ...setup, complete: true })} />;
  }

  return (
    <div className="flex h-dvh w-dvw gap-2 overflow-hidden bg-background p-2">
      <Sidebar />

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
        <Header />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto h-full w-full max-w-6xl px-6 py-6">
            {!ready ? (
              <div className="space-y-3">
                <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
                <div className="h-24 animate-pulse rounded-lg bg-muted" />
                <div className="h-24 animate-pulse rounded-lg bg-muted" />
              </div>
            ) : (
              <>
                {view === "today" && <DashboardView />}
                {view === "feed" && <FeedView />}
                {view === "resources" && <ResourcesView />}
                {view === "jobs" && (selectedJobId ? <JobDetailView /> : <JobsView />)}
                {view === "sources" && <SourcesView />}
                {view === "logs" && <LogsView />}
                {view === "settings" && <SettingsView />}
              </>
            )}
          </div>
        </main>

        <ReaderDrawer />
      </div>

      <CommandPalette />

      {/* Checks for a newer release once the app is up, and offers it. */}
      <UpdateNotice ready={ready} />
    </div>
  );
}
