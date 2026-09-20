"use client";

import React from "react";
import {
  Sun,
  Newspaper,
  Package,
  Share2,
  Inbox,
  Bookmark,
  Star,
  Archive,
  GitBranch,
  FileText,
  Sparkles,
  Radio,
  Database,
  Settings,
  Activity,
  BriefcaseBusiness,
} from "lucide-react";
import { cn } from "../lib/utils";
import { usePulse, type NavigationTab } from "../store/pulse";
import { useJobs } from "../store/jobs";
import type { ContentField, ItemCategory, ItemState } from "../lib/types";

interface NavEntry {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function NavRow({ entry }: { entry: NavEntry }) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      onClick={entry.onClick}
      aria-current={entry.active ? "page" : undefined}
      className={cn(
        "group relative flex w-full items-center justify-between rounded-md py-1.5 pl-3 pr-2 text-[13px] transition-colors",
        entry.active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {entry.active && (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" aria-hidden />
      )}
      <span className="flex items-center gap-2">
        <Icon className={cn("size-3.5", entry.active ? "text-primary" : "text-muted-foreground")} />
        {entry.label}
      </span>
      {entry.count !== undefined && (
        <span className="text-[11px] tabular-nums text-muted-foreground">{entry.count}</span>
      )}
    </button>
  );
}

export function Sidebar() {
  const view = usePulse((state) => state.view);
  const filters = usePulse((state) => state.filters);
  const stats = usePulse((state) => state.stats);
  const resources = usePulse((state) => state.resources);
  const desktop = usePulse((state) => state.desktop);
  const setView = usePulse((state) => state.setView);
  const setFilter = usePulse((state) => state.setFilter);

  const goToTab = (tab: NavigationTab) => setView(tab);

  /**
   * Each sidebar section is a fresh entry point, not an intersection with
   * whatever was selected before: a Stream picks a category and clears the
   * triage state, a Triage entry picks a state and clears the category. That
   * keeps the click showing exactly what the row's count said.
   */
  const goToFeed = (patch: { state?: ItemState | "all"; category?: ItemCategory; field?: ContentField }) => {
    setView("feed");
    setFilter({
      category: patch.category ?? "all",
      state: patch.state ?? "all",
      field: patch.field ?? "all",
    });
  };

  const groups: Array<{ label: string; entries: NavEntry[] }> = [
    {
      label: "Overview",
      entries: [
        { key: "today", label: "Today", icon: Sun, active: view === "today", onClick: () => goToTab("today") },
        { key: "feed", label: "Feed", icon: Newspaper, count: stats.total, active: view === "feed" && filters.category === "all" && filters.state === "all", onClick: () => goToFeed({}) },
        { key: "resources", label: "Resources", icon: Package, count: resources.length, active: view === "resources", onClick: () => goToTab("resources") },
        { key: "sources", label: "Sources", icon: Share2, active: view === "sources", onClick: () => goToTab("sources") },
        { key: "logs", label: "Logs", icon: Activity, active: view === "logs", onClick: () => goToTab("logs") },
      ],
    },
    {
      label: "Work",
      entries: [
        {
          key: "jobs",
          label: "Jobs",
          icon: BriefcaseBusiness,
          active: view === "jobs",
          // Leaving the detail page behind: clicking Jobs always lands on the list.
          onClick: () => {
            useJobs.getState().closeJob();
            goToTab("jobs");
          },
        },
      ],
    },
    {
      label: "Triage",
      entries: [
        { key: "inbox", label: "Inbox", icon: Inbox, count: stats.inbox, active: view === "feed" && filters.state === "inbox", onClick: () => goToFeed({ state: "inbox" }) },
        { key: "saved", label: "Reading queue", icon: Bookmark, count: stats.saved, active: view === "feed" && filters.state === "saved", onClick: () => goToFeed({ state: "saved" }) },
        { key: "important", label: "Important", icon: Star, count: stats.important, active: view === "feed" && filters.state === "important", onClick: () => goToFeed({ state: "important" }) },
        { key: "archived", label: "Archive", icon: Archive, count: stats.archived, active: view === "feed" && filters.state === "archived", onClick: () => goToFeed({ state: "archived" }) },
      ],
    },
    {
      label: "Streams",
      entries: [
        { key: "repo", label: "Repositories", icon: GitBranch, count: stats.repos, active: view === "feed" && filters.category === "repo", onClick: () => goToFeed({ category: "repo" }) },
        { key: "paper", label: "Papers", icon: FileText, count: stats.papers, active: view === "feed" && filters.category === "paper", onClick: () => goToFeed({ category: "paper" }) },
        { key: "resource", label: "Products & Docs", icon: Sparkles, count: stats.resources, active: view === "feed" && filters.category === "resource", onClick: () => goToFeed({ category: "resource" }) },
        { key: "news", label: "Discussions", icon: Radio, count: stats.news, active: view === "feed" && filters.category === "news", onClick: () => goToFeed({ category: "news" }) },
      ],
    },
  ];

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2.5 px-3 py-3">
        {/* The real app icon, same asset the bundle ships. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/app-icon-32.png" alt="" className="size-6 rounded-md" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-foreground">Pulse</div>
          <div className="text-[11px] text-muted-foreground">Tech tracker</div>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.entries.map((entry) => (
                <NavRow key={entry.key} entry={entry} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-border px-2 py-2">
        <NavRow
          entry={{
            key: "settings",
            label: "Settings",
            icon: Settings,
            active: view === "settings",
            onClick: () => goToTab("settings"),
          }}
        />
        <div className="flex items-center justify-between px-2.5 py-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Database className="size-3" />
            pulse.db
          </span>
          <span className={cn("font-medium", desktop ? "text-success" : "text-muted-foreground")}>
            {desktop ? "desktop" : "preview"}
          </span>
        </div>
      </div>
    </aside>
  );
}
