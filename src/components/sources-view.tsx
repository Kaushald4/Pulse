"use client";

import React from "react";
import {
  Globe,
  Lock,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Download,
  Loader2,
  Unplug,
  Pencil,
} from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { EmptyState } from "./empty-state";
import { Chip } from "./chip";
import { cn, formatRelativeTime } from "../lib/utils";
import {
  EMPTY_HELMSMAN_STATUS,
  getHelmsmanStatus,
  installHelmsman,
  type HelmsmanStatus,
} from "../lib/config";
import {
  groupSourcesByDomain,
  sourceFilterChips,
  type SourceGroup,
} from "../lib/sources/fetcher";
import { toast } from "../lib/toast";
import { usePulse } from "../store/pulse";
import type { SourceConnection, SourceOptions } from "../lib/types";

function HelmsmanBanner() {
  const [status, setStatus] = React.useState<HelmsmanStatus>(EMPTY_HELMSMAN_STATUS);
  const [installing, setInstalling] = React.useState(false);
  const desktop = usePulse((state) => state.desktop);

  React.useEffect(() => {
    void getHelmsmanStatus().then(setStatus);
  }, []);

  if (!desktop || status.path) return null;

  const install = async () => {
    setInstalling(true);
    try {
      const result = await installHelmsman();
      toast.success(`helmsman ${result.version ?? "installed"}`, `Downloaded ${result.asset}`);
      setStatus(await getHelmsmanStatus());
    } catch (err) {
      toast.error("Install failed", err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Card className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-dashed p-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">The extraction engine is not installed</p>
          <p className="text-[13px] text-muted-foreground">
            Pulse downloads helmsman from GitHub — one click, no path to configure.
          </p>
        </div>
      </div>
      <Button onClick={() => void install()} disabled={installing} className="shrink-0 gap-1.5">
        {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        {installing ? "Installing…" : "Install helmsman"}
      </Button>
    </Card>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type StatusTone = "success" | "danger" | "muted";

function sourceStatus(source: SourceConnection): { label: string; tone: StatusTone } {
  if (source.lastError) return { label: "Last sync failed", tone: "danger" };
  if (source.lastSyncAt) {
    return { label: `Synced ${formatRelativeTime(source.lastSyncAt)}`, tone: "success" };
  }
  if (source.authType === "browser_profile" && source.profileExists) {
    return { label: "Login saved · sync to verify", tone: "muted" };
  }
  if (source.authType === "browser_profile") return { label: "Not connected", tone: "muted" };
  return { label: "Never synced", tone: "muted" };
}

/** One status for a whole domain group, from its members' real outcomes. */
function groupStatus(sources: SourceConnection[]): { label: string; tone: StatusTone } {
  if (sources.length === 1) return sourceStatus(sources[0]);
  if (sources.some((source) => source.lastError)) return { label: "Last sync failed", tone: "danger" };

  const synced = sources.filter((source) => source.lastSyncAt);
  if (synced.length === 0) return { label: "Never synced", tone: "muted" };
  if (synced.length === sources.length) {
    const latest = synced
      .map((source) => new Date(source.lastSyncAt as string).getTime())
      .sort((a, b) => b - a)[0];
    return { label: `Synced ${formatRelativeTime(new Date(latest).toISOString())}`, tone: "success" };
  }
  return { label: `${synced.length} of ${sources.length} synced`, tone: "muted" };
}

const TONE_DOT: Record<StatusTone, string> = {
  success: "bg-success",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

function StatusBadge({ status }: { status: { label: string; tone: StatusTone } }) {
  if (status.tone === "success") {
    return (
      <Badge variant="success" className="shrink-0 gap-1">
        <CheckCircle2 className="size-3" aria-hidden />
        {status.label}
      </Badge>
    );
  }
  if (status.tone === "danger") {
    return (
      <Badge variant="destructive" className="shrink-0 gap-1">
        <AlertCircle className="size-3" aria-hidden />
        {status.label}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
      {status.label}
    </Badge>
  );
}

function GroupRow({
  group,
  active,
  onSelect,
}: {
  group: SourceGroup;
  active: boolean;
  onSelect: () => void;
}) {
  const status = groupStatus(group.sources);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-secondary" : "hover:bg-accent"
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[status.tone])} aria-hidden />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] text-foreground",
            active && "font-medium"
          )}
        >
          {group.label}
        </span>
        {group.sources.length > 1 && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {group.sources.length}
          </span>
        )}
      </span>
      <span className="truncate pl-3.5 text-[11px] text-muted-foreground">{group.domain}</span>
    </button>
  );
}

function OptionFields({
  source,
  draft,
  onChange,
}: {
  source: SourceConnection;
  draft: SourceOptions;
  onChange: (patch: SourceOptions) => void;
}) {
  switch (source.source) {
    case "hackernews":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Source</Label>
            <Select
              value={draft.mode ?? "feed"}
              onValueChange={(value) => onChange({ mode: value as "feed" | "search" })}
            >
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feed">Front page</SelectItem>
                <SelectItem value="search">Keyword search</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(draft.mode ?? "feed") === "search" && (
            <div className="space-y-1.5">
              <Label htmlFor={`${source.id}-queries`} className="text-xs">
                Keywords
              </Label>
              <Input
                id={`${source.id}-queries`}
                placeholder="AI agents, LLM"
                defaultValue={(draft.queries ?? []).join(", ")}
                onChange={(event) => onChange({ queries: splitList(event.target.value) })}
                className="h-8 text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">Comma separated, up to 12.</p>
            </div>
          )}
        </>
      );

    case "rss":
      return (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${source.id}-feedUrl`} className="text-xs">
              Feed URL
            </Label>
            <Input
              id={`${source.id}-feedUrl`}
              placeholder="https://example.com/feed"
              defaultValue={draft.feedUrl ?? ""}
              onChange={(event) => onChange({ feedUrl: event.target.value })}
              className="h-8 text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground">RSS or Atom.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${source.id}-limit`} className="text-xs">
              Items per sync
            </Label>
            <Input
              id={`${source.id}-limit`}
              type="number"
              min={1}
              max={50}
              placeholder="15"
              defaultValue={draft.limit ?? undefined}
              onChange={(event) => onChange({ limit: Number(event.target.value) })}
              className="h-8 text-[13px]"
            />
          </div>
        </>
      );

    case "reddit":
      return (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${source.id}-subreddits`} className="text-xs">
              Subreddits
            </Label>
            <Input
              id={`${source.id}-subreddits`}
              placeholder="localllama, MachineLearning"
              defaultValue={(draft.subreddits ?? []).join(", ")}
              onChange={(event) => onChange({ subreddits: splitList(event.target.value) })}
              className="h-8 text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Comma separated, up to 12. Each one is a separate extraction run.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sort</Label>
            <Select value={draft.sort ?? "hot"} onValueChange={(value) => onChange({ sort: value })}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hot">Hot</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="top">Top</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      );

    case "twitter":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Source</Label>
            <Select
              value={draft.mode ?? "feed"}
              onValueChange={(value) => onChange({ mode: value as "feed" | "search" })}
            >
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feed">Home timeline</SelectItem>
                <SelectItem value="search">Keyword search</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(draft.mode ?? "feed") === "search" && (
            <div className="space-y-1.5">
              <Label htmlFor={`${source.id}-keywords`} className="text-xs">
                Keywords
              </Label>
              <Input
                id={`${source.id}-keywords`}
                placeholder="deepseek, LLM inference"
                defaultValue={(draft.queries ?? []).join(", ")}
                onChange={(event) => onChange({ queries: splitList(event.target.value) })}
                className="h-8 text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">Comma separated, up to 5.</p>
            </div>
          )}
        </>
      );

    case "linkedin":
      return (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${source.id}-keywords`} className="text-xs">
              Job keywords
            </Label>
            <Input
              id={`${source.id}-keywords`}
              placeholder="AI Engineer"
              defaultValue={draft.keywords ?? ""}
              onChange={(event) => onChange({ keywords: event.target.value })}
              className="h-8 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${source.id}-location`} className="text-xs">
              Location
            </Label>
            <Input
              id={`${source.id}-location`}
              placeholder="Remote"
              defaultValue={draft.location ?? ""}
              onChange={(event) => onChange({ location: event.target.value })}
              className="h-8 text-[13px]"
            />
          </div>
        </>
      );

    case "arxiv":
      return (
        <div className="space-y-1.5">
          <Label htmlFor={`${source.id}-category`} className="text-xs">
            Category
          </Label>
          <Input
            id={`${source.id}-category`}
            placeholder="cs.AI"
            defaultValue={draft.category ?? ""}
            onChange={(event) => onChange({ category: event.target.value })}
            className="h-8 text-[13px]"
          />
          <p className="text-[11px] text-muted-foreground">e.g. cs.AI, cs.LG, cs.CL, stat.ML</p>
        </div>
      );

    case "devto":
      return (
        <div className="space-y-1.5">
          <Label htmlFor={`${source.id}-tag`} className="text-xs">
            Tag
          </Label>
          <Input
            id={`${source.id}-tag`}
            placeholder="ai"
            defaultValue={draft.tag ?? ""}
            onChange={(event) => onChange({ tag: event.target.value })}
            className="h-8 text-[13px]"
          />
        </div>
      );

    case "lobsters":
      return (
        <div className="space-y-1.5">
          <Label className="text-xs">Sort</Label>
          <Select value={draft.sort ?? "hottest"} onValueChange={(value) => onChange({ sort: value })}>
            <SelectTrigger className="h-8 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hottest">Hottest</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );

    case "github":
      return (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${source.id}-language`} className="text-xs">
              Language
            </Label>
            <Input
              id={`${source.id}-language`}
              placeholder="Rust, Python, TypeScript"
              defaultValue={draft.language ?? ""}
              onChange={(event) => onChange({ language: event.target.value })}
              className="h-8 text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground">Blank includes every language.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${source.id}-days`} className="text-xs">
              Created within (days)
            </Label>
            <Input
              id={`${source.id}-days`}
              type="number"
              min={1}
              max={90}
              placeholder="7"
              defaultValue={draft.days ?? 7}
              onChange={(event) => onChange({ days: Number(event.target.value) })}
              className="h-8 text-[13px]"
            />
          </div>
        </>
      );

    default:
      return (
        <div className="space-y-1.5">
          <Label htmlFor={`${source.id}-limit`} className="text-xs">
            Items per sync
          </Label>
          <Input
            id={`${source.id}-limit`}
            type="number"
            min={1}
            max={50}
            placeholder="15"
            defaultValue={draft.limit ?? undefined}
            onChange={(event) => onChange({ limit: Number(event.target.value) })}
            className="h-8 text-[13px]"
          />
        </div>
      );
  }
}

/** The applied defaults, as chips — what this source actually collects. */
function FilterChips({ source }: { source: SourceConnection }) {
  const chips = sourceFilterChips(source);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <Chip key={chip} label={chip} />
      ))}
    </div>
  );
}

function SourceEditor({ source }: { source: SourceConnection }) {
  const sources = usePulse((state) => state.sources);
  const updateSourceOptions = usePulse((state) => state.updateSourceOptions);
  const [draft, setDraft] = React.useState<SourceOptions>(source.options ?? {});

  React.useEffect(() => {
    setDraft(sources.find((entry) => entry.id === source.id)?.options ?? {});
  }, [sources, source.id]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(source.options ?? {});

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <OptionFields source={source} draft={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void updateSourceOptions(source.id, draft)} disabled={!dirty}>
          Save settings
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(source.options ?? {})}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}

/** A single-source domain: the full focused editor. */
function SingleSourceDetail({ source }: { source: SourceConnection }) {
  const syncing = usePulse((state) => state.syncing);
  const syncingSource = usePulse((state) => state.syncingSource);
  const syncOne = usePulse((state) => state.syncOne);
  const connectSource = usePulse((state) => state.connectSource);
  const disconnectSource = usePulse((state) => state.disconnectSource);
  const refreshSources = usePulse((state) => state.refreshSources);

  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const needsProfile = source.authType === "browser_profile";
  const isThisSyncing = syncingSource === source.id;

  return (
    <Card className="flex flex-col gap-0 overflow-hidden p-0">
      <div className="space-y-3 border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{source.name}</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {needsProfile
                ? `Signed-in platform feed${source.siteDomain ? ` · ${source.siteDomain}` : ""}`
                : "Public feed — no login needed"}
            </p>
          </div>
          <StatusBadge status={sourceStatus(source)} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {needsProfile && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await connectSource(source);
                await refreshSources();
              }}
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              {source.profileExists ? "Re-authenticate" : "Connect"}
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => void syncOne(source.id)}
            disabled={syncing || (needsProfile && !source.profileExists)}
            className="gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", isThisSyncing && "animate-spin")} />
            {isThisSyncing ? "Syncing…" : "Sync now"}
          </Button>
          {needsProfile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDisconnect(true)}
              disabled={!source.profileExists}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Unplug className="size-3.5" />
              Disconnect
            </Button>
          )}
        </div>

        {source.lastError && (
          <p className="break-words rounded-md border border-destructive/25 bg-destructive/5 p-2.5 text-[12px] leading-4 text-destructive">
            {source.lastError}
          </p>
        )}
      </div>

      <div className="space-y-4 p-5">
        <div className="space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Default filters
          </h3>
          <FilterChips source={source} />
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Edit
          </h3>
          <SourceEditor source={source} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
        <span suppressHydrationWarning>
          {source.lastSyncAt ? `Last synced ${formatRelativeTime(source.lastSyncAt)}` : "Never synced"}
        </span>
        <span className="font-mono">{source.source}</span>
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {source.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the saved browser profile for{" "}
              <span className="font-mono text-xs">{source.profileName}</span>, including its cookies and
              local storage. You will need to sign in again to sync this source.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void disconnectSource(source);
                setConfirmDisconnect(false);
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function GroupMember({ source }: { source: SourceConnection }) {
  const syncing = usePulse((state) => state.syncing);
  const syncingSource = usePulse((state) => state.syncingSource);
  const syncOne = usePulse((state) => state.syncOne);
  const [editing, setEditing] = React.useState(false);

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="text-[13px] font-medium text-foreground">{source.name}</div>
          <FilterChips source={source} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setEditing((value) => !value)} className="gap-1.5">
            <Pencil className="size-3" />
            {editing ? "Done" : "Edit"}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label={`Sync ${source.name}`}
            disabled={syncing}
            onClick={() => void syncOne(source.id)}
            className="size-8"
          >
            <RefreshCw className={cn("size-3.5", syncingSource === source.id && "animate-spin")} />
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 border-t border-border pt-4">
          <SourceEditor source={source} />
        </div>
      )}
    </div>
  );
}

/** A domain with several sources: one entry, all of them together. */
function DomainGroupDetail({ group }: { group: SourceGroup }) {
  const syncing = usePulse((state) => state.syncing);
  const syncGroup = usePulse((state) => state.syncGroup);

  const chips = Array.from(new Set(group.sources.flatMap((source) => sourceFilterChips(source))));

  return (
    <Card className="flex flex-col gap-0 overflow-hidden p-0">
      <div className="space-y-3 border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{group.label}</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {group.domain} · {group.sources.length} sources
            </p>
          </div>
          <StatusBadge status={groupStatus(group.sources)} />
        </div>

        <Button
          size="sm"
          onClick={() => void syncGroup(group.sources.map((source) => source.id))}
          disabled={syncing}
          className="gap-1.5"
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : `Sync all ${group.sources.length}`}
        </Button>

        <div className="space-y-3 pt-1">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Default filters
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Chip key={chip} label={chip} />
            ))}
          </div>
        </div>
      </div>

      <div className="divide-y divide-border">
        {group.sources.map((source) => (
          <GroupMember key={source.id} source={source} />
        ))}
      </div>
    </Card>
  );
}

export function SourcesView() {
  const sources = usePulse((state) => state.sources);
  const syncing = usePulse((state) => state.syncing);
  const syncProgress = usePulse((state) => state.syncProgress);
  const syncAll = usePulse((state) => state.syncAll);

  const groups = React.useMemo(() => groupSourcesByDomain(sources), [sources]);
  const [selectedDomain, setSelectedDomain] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (groups.length === 0) return;
    if (!selectedDomain || !groups.some((group) => group.domain === selectedDomain)) {
      setSelectedDomain(groups[0].domain);
    }
  }, [groups, selectedDomain]);

  const privateGroups = groups.filter((group) =>
    group.sources.some((source) => source.authType === "browser_profile")
  );
  const publicGroups = groups.filter(
    (group) => !group.sources.some((source) => source.authType === "browser_profile")
  );
  const selected = groups.find((group) => group.domain === selectedDomain) ?? groups[0] ?? null;

  const sections = [
    { label: "Private sources", icon: Lock, items: privateGroups },
    { label: "Public feeds", icon: Globe, items: publicGroups },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <HelmsmanBanner />

      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Public feeds need no login. Platform feeds use a saved Chrome profile.
          </p>
        </div>
        <Button size="sm" onClick={() => void syncAll()} disabled={syncing} className="gap-1.5">
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync all"}
        </Button>
      </div>

      {syncing && syncProgress && (
        <Card className="shrink-0 space-y-2 p-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 text-foreground">
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              Syncing <span className="font-medium">{syncProgress.label}</span>
            </span>
            <span className="tabular-nums text-muted-foreground">
              {syncProgress.index} / {syncProgress.total}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round((syncProgress.index / syncProgress.total) * 100)}%` }}
            />
          </div>
        </Card>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No sources yet"
          description="Sources appear here once the app has loaded its default catalog."
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)] lg:overflow-hidden">
          <nav className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {sections.map((section) => {
              if (section.items.length === 0) return null;
              const SectionIcon = section.icon;
              return (
                <div key={section.label} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <SectionIcon className="size-3" aria-hidden />
                    {section.label}
                  </div>
                  <div className="space-y-0.5">
                    {section.items.map((group) => (
                      <GroupRow
                        key={group.domain}
                        group={group}
                        active={group.domain === selected?.domain}
                        onSelect={() => setSelectedDomain(group.domain)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {selected ? (
              selected.sources.length === 1 ? (
                <SingleSourceDetail key={selected.sources[0].id} source={selected.sources[0]} />
              ) : (
                <DomainGroupDetail key={selected.domain} group={selected} />
              )
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
