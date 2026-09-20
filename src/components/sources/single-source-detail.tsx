/** A single-source domain: the full focused editor and its actions. */
import React from "react";
import { ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { cn, formatRelativeTime } from "../../lib/utils";
import { usePulse } from "../../store/pulse";
import type { SourceConnection } from "../../lib/types";
import { FilterChips } from "./filter-chips";
import { SourceEditor } from "./source-editor";
import { StatusBadge, sourceStatus } from "./status";

/** A single-source domain: the full focused editor. */
export function SingleSourceDetail({ source }: { source: SourceConnection }) {
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
                : "Public feed - no login needed"}
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
