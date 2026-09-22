"use client";

import React from "react";
import { Bookmark, Star, Archive, ExternalLink, MessageSquare } from "lucide-react";
import type { PulseItem } from "../lib/types";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Button } from "./ui/button";
import { Chip, SourceChip } from "./chip";
import { Favicon, HostLabel, LinkThumb } from "./link-preview";
import { formatNumber, formatRelativeTime, cn } from "../lib/utils";
import { openExternal } from "../lib/config";
import { categoryLabel, fieldLabel, stateLabel } from "../lib/taxonomy";
import { usePulse } from "../store/pulse";

interface FeedCardProps {
  item: PulseItem;
  isSelected?: boolean;
  onSelect: () => void;
}

export function FeedCard({ item, isSelected, onSelect }: FeedCardProps) {
  const toggleState = usePulse((state) => state.toggleState);
  const setFilter = usePulse((state) => state.setFilter);
  const setView = usePulse((state) => state.setView);

  const isSaved = item.state === "saved";
  const isImportant = item.state === "important";
  const isArchived = item.state === "archived";
  const excerpt = item.why || item.linkDescription || item.body;

  const stop = (event: React.MouseEvent) => event.stopPropagation();

  const actions = [
    {
      key: "saved",
      label: isSaved ? "Remove from reading queue" : "Save for later",
      shortcut: "s",
      active: isSaved,
      icon: Bookmark,
      onClick: () => void toggleState(item.id, "saved"),
    },
    {
      key: "important",
      label: isImportant ? "Unmark important" : "Mark important",
      shortcut: "i",
      active: isImportant,
      icon: Star,
      onClick: () => void toggleState(item.id, "important"),
    },
    {
      key: "archived",
      label: isArchived ? "Move to inbox" : "Archive",
      shortcut: "a",
      active: isArchived,
      icon: Archive,
      onClick: () => void toggleState(item.id, "archived"),
    },
  ];

  return (
    <Card
      onClick={onSelect}
      className={cn(
        "group gap-0 p-0 transition-colors hover:bg-accent/40",
        isSelected && "border-primary/40 bg-accent/40"
      )}
    >
      <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 p-4 sm:flex-row">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start gap-2">
            <Favicon url={item.url} className="mt-1.5" />
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                stop(event);
                void openExternal(item.url);
              }}
              className="text-pretty text-[0.9375rem] font-medium leading-6 text-foreground decoration-muted-foreground/40 underline-offset-4 hover:underline"
            >
              {item.title}
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <SourceChip source={item.source} />
            <Chip label={categoryLabel(item.category)} />
            {typeof item.signal === "number" && item.signal >= 0.8 && (
              <Chip label="High signal" tone="success" />
            )}
            {item.author && <span>by {item.author}</span>}
            <span>·</span>
            <HostLabel url={item.url} />
            <span>·</span>
            <span suppressHydrationWarning>{formatRelativeTime(item.publishedAt)}</span>
            {item.state !== "inbox" && (
              <Chip
                label={stateLabel(item.state)}
                tone={item.state === "important" ? "warning" : item.state === "saved" ? "success" : "neutral"}
              />
            )}
          </div>
        </div>

        <div className="flex w-full shrink-0 items-start justify-between gap-3 sm:w-auto sm:justify-start">
          <div className="text-xs tabular-nums text-muted-foreground sm:text-right">
            {item.score > 0 && (
              <div>
                {item.category === "repo"
                  ? `${formatNumber(item.score)} stars`
                  : `${formatNumber(item.score)} pts`}
              </div>
            )}
            {item.commentsCount > 0 && (
              <div className="inline-flex items-center gap-1">
                <MessageSquare className="size-3 sm:hidden" />
                {formatNumber(item.commentsCount)} comments
              </div>
            )}
          </div>

          <div
            className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 data-[pinned=true]:opacity-100"
            data-pinned={isSaved || isImportant || isArchived}
            onClick={stop}
          >
            {actions.map((action) => (
              <Button
                key={action.key}
                variant="ghost"
                size="icon"
                aria-label={action.label}
                title={`${action.label} · ${action.shortcut}`}
                onClick={action.onClick}
                className={cn("size-7 text-muted-foreground", action.active && "text-foreground")}
              >
                <action.icon className="size-3.5" fill={action.active ? "currentColor" : "none"} />
              </Button>
            ))}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open original"
              title="Open original · o"
              onClick={() => void openExternal(item.url)}
              className="size-7 text-muted-foreground"
            >
              <ExternalLink className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {(excerpt || item.imageUrl) && (
        <CardContent className="px-4 pb-4 pt-0">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              {excerpt && (
                <p className="line-clamp-3 text-[13px] leading-5 text-muted-foreground">{excerpt}</p>
              )}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5" onClick={stop}>
                  {item.tags
                    .filter((tag) => tag !== item.topic)
                    .slice(0, 4)
                    .map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setFilter({ tag, category: "all" });
                          setView("feed");
                        }}
                        className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        #{tag}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <LinkThumb src={item.imageUrl} className="hidden sm:block" />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
