"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Chip } from "./chip";
import { Favicon } from "./link-preview";
import { usePulse } from "../store/pulse";
import { getItemsByIds } from "../lib/db/items";
import type { PulseItem } from "../lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 5;

const dayFormat = new Intl.DateTimeFormat("en", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function keyFor(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function formatDay(date: string): string {
  const today = new Date();
  if (date === keyFor(today)) return "Today";
  if (date === keyFor(new Date(today.getTime() - DAY_MS))) return "Yesterday";

  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : dayFormat.format(parsed);
}

function Mentions({ ids }: { ids: string[] }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<PulseItem[] | null>(null);

  React.useEffect(() => {
    if (!open || items) return;
    let active = true;
    void getItemsByIds(ids).then((rows) => {
      if (active) setItems(rows);
    });
    return () => {
      active = false;
    };
  }, [open, items, ids]);

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={`size-3.5 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
        Mentions
        <span className="font-normal text-muted-foreground/70">{ids.length}</span>
      </button>
      {open && (
        <ul className="mt-2.5 max-h-64 space-y-0.5 overflow-y-auto pr-1">
          {items === null ? (
            <li className="py-1 text-[12px] text-muted-foreground">Loading…</li>
          ) : items.length === 0 ? (
            <li className="py-1 text-[12px] text-muted-foreground">None found.</li>
          ) : (
            items.map((item) => (
              <li key={item.id}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group -mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1.5 no-underline transition-colors hover:bg-accent"
                >
                  <Favicon url={item.url} className="mt-0" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground group-hover:underline">
                    {item.title}
                  </span>
                  {item.topic && (
                    <span className="shrink-0">
                      <Chip label={item.topic} />
                    </span>
                  )}
                </a>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export function BriefingsView() {
  const briefings = usePulse((state) => state.briefings);
  const loadBriefings = usePulse((state) => state.loadBriefings);
  const [visible, setVisible] = React.useState(PAGE);
  const sentinel = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    void loadBriefings();
  }, [loadBriefings]);

  const ordered = React.useMemo(
    () => [...briefings].sort((a, b) => b.date.localeCompare(a.date)),
    [briefings]
  );

  React.useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible((count) => Math.min(count + PAGE, ordered.length));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ordered.length]);

  const shown = ordered.slice(0, visible);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Briefings</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Every daily briefing Pulse has written, newest first.
        </p>
      </div>

      {ordered.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No briefings yet. One is written each day you open Pulse.
        </p>
      ) : (
        <div>
          {shown.map((row) => (
            <section key={row.id} className="space-y-2.5 pb-10">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {formatDay(row.date)}
              </h2>
              <Card>
                <CardHeader className="gap-2 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-[15px] font-semibold tracking-tight">{row.title}</CardTitle>
                    <div className="flex flex-wrap items-center gap-1">
                      {row.sourcesUsed.slice(0, 5).map((source) => (
                        <span key={source} className="text-[11px] text-muted-foreground">
                          {source}
                        </span>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="max-w-[68ch] text-[13.5px] leading-[1.7] text-muted-foreground">
                    {row.summary}
                  </p>
                  {row.keyHappenings.length > 0 && (
                    <ul className="space-y-2.5">
                      {row.keyHappenings.map((entry, index) => (
                        <li key={index} className="flex items-start gap-2.5 text-[13px] leading-5">
                          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/70" />
                          <span className="text-foreground">{entry}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(row.itemIds?.length ?? 0) > 0 && <Mentions ids={row.itemIds ?? []} />}
                </CardContent>
              </Card>
            </section>
          ))}

          {visible < ordered.length && (
            <div ref={sentinel} className="flex items-center justify-center py-2">
              <span className="text-[11px] text-muted-foreground">Loading more briefings…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
