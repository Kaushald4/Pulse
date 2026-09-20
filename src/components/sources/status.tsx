/**
 * How a source reports itself: the status line for one source, the rolled-up
 * status for a domain, and the badge both of them render into.
 */
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "../ui/badge";
import { formatRelativeTime } from "../../lib/utils";
import type { SourceConnection } from "../../lib/types";

type StatusTone = "success" | "danger" | "muted";

export function sourceStatus(source: SourceConnection): { label: string; tone: StatusTone } {
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
export function groupStatus(sources: SourceConnection[]): { label: string; tone: StatusTone } {
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

export const TONE_DOT: Record<StatusTone, string> = {
  success: "bg-success",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

export function StatusBadge({ status }: { status: { label: string; tone: StatusTone } }) {
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
