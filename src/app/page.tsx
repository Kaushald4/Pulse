"use client";

import React from "react";
import { Sidebar } from "../components/sidebar";
import { Header } from "../components/header";
import { DashboardView } from "../components/dashboard-view";
import { FeedView } from "../components/feed-view";
import { ResourcesView } from "../components/resources-view";
import { SourcesView } from "../components/sources-view";
import { LogsView } from "../components/logs-view";
import { SettingsView } from "../components/settings-view";
import { ReaderDrawer } from "../components/reader-drawer";
import { CommandPalette } from "../components/command-palette";
import { usePulse } from "../store/pulse";
import { openExternal } from "../lib/config";

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

  React.useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!ready || !('__TAURI_INTERNALS__' in window)) return;
    let unlisten: Array<() => void> = [];
    void import("@tauri-apps/api/event").then(({ listen }) =>
      Promise.all([
        listen("tray-sync-request", () => void usePulse.getState().syncAll()),
        listen("background-sync-due", async () => {
          const current = usePulse.getState();
          if (current.syncing || !current.schedule.enabled) return;
          await current.syncAll();
          if (current.schedule.notify) {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("send_notification", { title: "Pulse sync complete", body: "Your signal desk has fresh items to review." });
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
    </div>
  );
}
