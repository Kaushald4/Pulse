"use client";

import React from "react";
import {
  X,
  ExternalLink,
  Bookmark,
  Star,
  Archive,
  Copy,
  Check,
  Calendar,
  User,
  MessageSquare,
  TrendingUp,
  Sparkles,
  Loader2,
  Save,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Chip, SourceChip } from "./chip";
import { Favicon, HostLabel } from "./link-preview";
import { formatNumber, formatRelativeTime, cn } from "../lib/utils";
import { openExternal } from "../lib/config";
import { categoryLabel, fieldLabel, stateTone, topicLabel } from "../lib/taxonomy";
import { usePulse } from "../store/pulse";

export function ReaderDrawer() {
  const selectedItemId = usePulse((state) => state.selectedItemId);
  const items = usePulse((state) => state.items);
  const drawerOpen = usePulse((state) => state.drawerOpen);
  const closeDrawer = usePulse((state) => state.closeDrawer);
  const toggleState = usePulse((state) => state.toggleState);
  const setFilter = usePulse((state) => state.setFilter);
  const setView = usePulse((state) => state.setView);
  const fetchItemContent = usePulse((state) => state.fetchItemContent);
  const setNotes = usePulse((state) => state.setNotes);
  const recordFeedback = usePulse((state) => state.recordFeedback);
  const contentLoadingId = usePulse((state) => state.contentLoadingId);
  const desktop = usePulse((state) => state.desktop);
  const [copied, setCopied] = React.useState(false);
  const [notes, setNotesDraft] = React.useState("");
  const [notesDirty, setNotesDirty] = React.useState(false);
  const loading = contentLoadingId === selectedItemId;

  const item = React.useMemo(
    () => items.find((entry) => entry.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  React.useEffect(() => {
    setCopied(false);
    setNotesDraft(item?.notes ?? "");
    setNotesDirty(false);
  }, [selectedItemId, item?.notes]);

  if (!item) return null;

  const isSaved = item.state === "saved";
  const isImportant = item.state === "important";
  const isArchived = item.state === "archived";

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("[Pulse] Clipboard unavailable:", err);
    }
  };

  return (
    <Sheet open={drawerOpen} onOpenChange={(open) => !open && closeDrawer()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        aria-describedby={undefined}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3 pr-12">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Chip label={categoryLabel(item.category)} />
            <SourceChip source={item.source} />
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Save for later"
                  onClick={() => void toggleState(item.id, "saved")}
                  className={cn("size-8", isSaved && "text-foreground")}
                >
                  <Bookmark className="size-4" fill={isSaved ? "currentColor" : "none"} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save for later · s</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Mark important"
                  onClick={() => void toggleState(item.id, "important")}
                  className={cn("size-8", isImportant && "text-warning")}
                >
                  <Star className="size-4" fill={isImportant ? "currentColor" : "none"} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Important · i</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Archive"
                  onClick={() => void toggleState(item.id, "archived")}
                  className={cn("size-8", isArchived && "text-foreground")}
                >
                  <Archive className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive · a</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy URL"
                  onClick={() => void copyUrl()}
                  className="size-8"
                >
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy URL</TooltipContent>
            </Tooltip>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openExternal(item.url)}
              className="ml-1 gap-1"
            >
              Open
              <ExternalLink className="size-3" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <SheetTitle asChild>
            <h1 className="flex items-start gap-2.5 text-pretty text-lg font-semibold leading-7 text-foreground">
              <Favicon url={item.url} className="mt-1.5 size-4" />
              <span>{item.title}</span>
            </h1>
          </SheetTitle>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <HostLabel url={item.url} className="flex items-center gap-1.5 text-xs" />
            {item.author && (
              <span className="flex items-center gap-1.5">
                <User className="size-3.5" />
                <span className="font-medium text-foreground">{item.author}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              <span suppressHydrationWarning>{formatRelativeTime(item.publishedAt)}</span>
            </span>
            {item.score > 0 && (
              <span className="flex items-center gap-1.5 tabular-nums">
                <TrendingUp className="size-3.5" />
                {formatNumber(item.score)}
              </span>
            )}
            {item.commentsCount > 0 && (
              <span className="flex items-center gap-1.5 tabular-nums">
                <MessageSquare className="size-3.5" />
                {formatNumber(item.commentsCount)}
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <Chip label={fieldLabel(item.field)} />
            {item.state !== "inbox" && <Chip label={item.state} tone={stateTone(item.state)} />}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void fetchItemContent(item.id)}
              disabled={loading || !desktop}
              className="gap-1.5"
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {loading ? "Fetching…" : item.contentText ? "Re-fetch & summarize" : "Fetch & summarize"}
            </Button>
            {item.contentEngine && (
              <span className="text-[11px] text-muted-foreground">via {item.contentEngine}</span>
            )}
            {item.contentFetchedAt && (
              <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                {formatRelativeTime(item.contentFetchedAt)}
              </span>
            )}
          </div>

          <Separator className="my-5" />

          {item.contentSummary && (
            <div className="mb-5 rounded-lg border border-primary/25 bg-primary/5 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                <Sparkles className="size-3" />
                Summary
              </div>
              <p className="mt-1.5 text-[13px] leading-6 text-foreground">{item.contentSummary}</p>
            </div>
          )}

          {item.why && (
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-primary">
                Why this matters
              </div>
              <p className="mt-1.5 text-[13px] leading-5 text-foreground">{item.why}</p>
            </div>
          )}

          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Your note
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={!notesDirty}
                onClick={() => void setNotes(item.id, notes).then(() => setNotesDirty(false))}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <Save className="size-3.5" />
                Save note
              </Button>
            </div>
            <textarea
              value={notes}
              onChange={(event) => {
                setNotesDraft(event.target.value);
                setNotesDirty(true);
              }}
              placeholder="Capture an idea or follow-up…"
              className="min-h-20 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="mt-5 space-y-2 rounded-md border border-border p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Tune your feed
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void recordFeedback(item.id, "more_like_this")}
                className="gap-1.5"
              >
                <ThumbsUp className="size-3.5" />
                More like this
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void recordFeedback(item.id, "less_like_this")}
                className="gap-1.5"
              >
                <ThumbsDown className="size-3.5" />
                Less like this
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {item.contentText ? "Full content" : "Content"}
            </div>
            <div className="whitespace-pre-line text-[13px] leading-6 text-foreground/90">
              {item.contentText ||
                item.body ||
                "No excerpt available. Use Fetch & summarize to pull the full page."}
            </div>
          </div>

          {item.tags.length > 0 && (
            <div className="mt-5 space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      setFilter({ tag, category: "all" });
                      setView("feed");
                      closeDrawer();
                    }}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {item.topic && (
            <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Topic</span>
              <Chip label={topicLabel(item.topic)} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>j/k navigate</span>
            <span>s save</span>
            <span>i star</span>
            <span>o open</span>
          </div>
          <span>Esc close</span>
        </div>
      </SheetContent>
    </Sheet>
  );
}
