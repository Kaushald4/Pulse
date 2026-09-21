"use client";

import React from "react";
import { Download, Loader2, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Progress } from "./ui/progress";
import { useUpdates } from "../store/updates";

/**
 * Offers a newer release once per launch, with Update or Skip.
 *
 * The check itself lives in the updates store, so the same state also backs the
 * manual "Check for updates" in Settings. Nothing here runs unless something is
 * actually available: no release, no network, or a version the user skipped all
 * leave the screen untouched.
 */
export function UpdateNotice({ ready }: { ready: boolean }) {
  const update = useUpdates((state) => state.update);
  const promptOpen = useUpdates((state) => state.promptOpen);
  const installing = useUpdates((state) => state.installing);
  const progress = useUpdates((state) => state.progress);
  const error = useUpdates((state) => state.error);
  const check = useUpdates((state) => state.check);
  const install = useUpdates((state) => state.install);
  const skip = useUpdates((state) => state.skip);

  /** The launch check. Runs once, and only after the app is up. */
  const checked = React.useRef(false);
  React.useEffect(() => {
    if (!ready || checked.current) return;
    checked.current = true;
    void check({ prompt: true });
  }, [ready, check]);

  if (!promptOpen || !update) return null;

  const percent = progress?.fraction != null ? Math.round(progress.fraction * 100) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !installing && skip()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Pulse {update.version} is available
          </DialogTitle>
          <DialogDescription>
            You are on {update.currentVersion}. Updating installs it in place and restarts Pulse.
          </DialogDescription>
        </DialogHeader>

        {update.notes && (
          <div className="max-h-56 overflow-y-auto whitespace-pre-line rounded-lg border border-border/60 bg-muted/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
            {update.notes}
          </div>
        )}

        {installing && (
          <div className="space-y-2">
            <Progress value={percent ?? undefined} />
            <p className="text-[12px] text-muted-foreground">
              {progress
                ? `Downloading${percent != null ? `, ${percent}%` : ""}`
                : "Starting the download"}
            </p>
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[12px] leading-relaxed text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={skip} disabled={installing}>
            Skip this version
          </Button>
          <Button onClick={() => void install()} disabled={installing} className="gap-1.5">
            {installing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {installing ? "Installing…" : "Update now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
