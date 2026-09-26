"use client";

import React from "react";
import { Search, RefreshCw } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { Button } from "./ui/button";
import { ThemeToggle } from "./theme-toggle";
import { usePulse } from "../store/pulse";
import { useModKey } from "../lib/platform";

export function Header() {
  const syncing = usePulse((state) => state.syncing);
  const syncProgress = usePulse((state) => state.syncProgress);
  const syncAll = usePulse((state) => state.syncAll);
  const setPaletteOpen = usePulse((state) => state.setPaletteOpen);
  const total = usePulse((state) => state.stats.total);
  const modKey = useModKey();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
      {/* Search is a single control that opens the command palette - one place
          to look, and the same surface as the keyboard shortcut. */}
      <Button
        variant="outline"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search"
        className="h-8 w-full max-w-md justify-start gap-2 px-2.5 text-xs font-normal text-muted-foreground"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">Search items, sources, commands…</span>
        <kbd
          suppressHydrationWarning
          className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          {modKey}K
        </kbd>
      </Button>

      <div className="flex-1" />

      <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
        {total} {total === 1 ? "item" : "items"}
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={() => void syncAll()}
        disabled={syncing}
        title={syncProgress ? `Syncing ${syncProgress.label}…` : "Sync all sources"}
        className="gap-1.5"
      >
        {syncing ? (
          <ThinkingOrb state="connecting" size={20} aria-hidden="true" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        <span className="hidden sm:inline">
          {syncing && syncProgress
            ? `Syncing ${syncProgress.index}/${syncProgress.total}`
            : syncing
              ? "Syncing…"
              : "Sync"}
        </span>
      </Button>

      <ThemeToggle />
    </header>
  );
}
