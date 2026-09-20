"use client";

import React from "react";
import {
  RefreshCw,
  Newspaper,
  GitBranch,
  FileText,
  Sparkles,
  Radio,
  Settings,
  Sun,
  Bookmark,
  Star,
  Search,
  Activity,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command";
import { SOURCE_LABELS, categoryLabel, humanize } from "../lib/taxonomy";
import { formatRelativeTime } from "../lib/utils";
import { usePulse } from "../store/pulse";

/**
 * cmdk does the filtering, so every item carries a searchable `value` built from
 * the fields a user would actually type (title, author, source, tags).
 */
const MAX_INDEXED_ITEMS = 60;

export function CommandPalette() {
  const open = usePulse((state) => state.paletteOpen);
  const setOpen = usePulse((state) => state.setPaletteOpen);
  const items = usePulse((state) => state.items);
  const openDrawer = usePulse((state) => state.openDrawer);
  const setFilter = usePulse((state) => state.setFilter);
  const setView = usePulse((state) => state.setView);
  const syncAll = usePulse((state) => state.syncAll);

  const indexed = React.useMemo(() => items.slice(0, MAX_INDEXED_ITEMS), [items]);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const run = React.useCallback(
    (action: () => void) => {
      setOpen(false);
      action();
    },
    [setOpen]
  );

  const destinations = [
    { label: "Today", icon: Sun, run: () => setView("today") },
    { label: "Feed", icon: Newspaper, run: () => setView("feed") },
    { label: "Resources", icon: Sparkles, run: () => setView("resources") },
    { label: "Sources", icon: Radio, run: () => setView("sources") },
    { label: "Logs", icon: Activity, run: () => setView("logs") },
    { label: "Settings", icon: Settings, run: () => setView("settings") },
  ];

  const filters = [
    { label: "Repositories", icon: GitBranch, run: () => { setView("feed"); setFilter({ category: "repo", state: "all", field: "all" }); } },
    { label: "Papers", icon: FileText, run: () => { setView("feed"); setFilter({ category: "paper", state: "all", field: "all" }); } },
    { label: "Products", icon: Sparkles, run: () => { setView("feed"); setFilter({ category: "resource", state: "all", field: "all" }); } },
    { label: "Discussions", icon: Radio, run: () => { setView("feed"); setFilter({ category: "news", state: "all", field: "all" }); } },
    { label: "Saved", icon: Bookmark, run: () => { setView("feed"); setFilter({ state: "saved", category: "all", field: "all" }); } },
    { label: "Important", icon: Star, run: () => { setView("feed"); setFilter({ state: "important", category: "all", field: "all" }); } },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search items or run a command…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        {query.trim() && (
          <>
            <CommandGroup heading="Search">
              <CommandItem
                value={`filter feed ${query}`}
                onSelect={() =>
                  run(() => {
                    setFilter({ query: query.trim() });
                    setView("feed");
                  })
                }
              >
                <Search />
                <span>
                  Filter feed by <span className="font-medium">“{query.trim()}”</span>
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Actions">
          <CommandItem value="sync all sources refresh" onSelect={() => run(() => void syncAll())}>
            <RefreshCw />
            <span>Sync all sources</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Go to">
          {destinations.map((entry) => (
            <CommandItem key={entry.label} value={`go to ${entry.label}`} onSelect={() => run(entry.run)}>
              <entry.icon />
              <span>{entry.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Filter feed">
          {filters.map((entry) => (
            <CommandItem key={entry.label} value={`filter ${entry.label}`} onSelect={() => run(entry.run)}>
              <entry.icon />
              <span>{entry.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {indexed.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Items">
              {indexed.map((item) => (
                <CommandItem
                  key={item.id}
                  value={[item.title, item.author ?? "", item.source, ...item.tags].join(" ")}
                  onSelect={() => run(() => openDrawer(item.id))}
                  className="flex-col items-start gap-1"
                >
                  <span className="line-clamp-1 text-[13px] font-medium text-foreground">{item.title}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{categoryLabel(item.category)}</span>
                    <span>·</span>
                    <span>{SOURCE_LABELS[item.source] ?? humanize(item.source)}</span>
                    <span>·</span>
                    <span suppressHydrationWarning>{formatRelativeTime(item.publishedAt)}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
