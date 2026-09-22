"use client";

import React from "react";
import { Check, Database, Download, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { DetailRow, Hint, SectionIntro } from "./shared";
import {
  EMPTY_HELMSMAN_STATUS,
  getAppVersion,
  getHelmsmanStatus,
  type HelmsmanStatus,
} from "../../lib/config";
import { getStorageStatus } from "../../lib/db/client";
import { usePulse } from "../../store/pulse";
import { useUpdates } from "../../store/updates";

export function AboutSection() {
  const desktop = usePulse((state) => state.desktop);
  const [version, setVersion] = React.useState<string | null>(null);
  const [helmsman, setHelmsman] = React.useState<HelmsmanStatus>(EMPTY_HELMSMAN_STATUS);

  const status = useUpdates((state) => state.status);
  const available = useUpdates((state) => state.update);
  const installing = useUpdates((state) => state.installing);
  const progress = useUpdates((state) => state.progress);
  const check = useUpdates((state) => state.check);
  const install = useUpdates((state) => state.install);

  // Read straight from the db layer. It is fixed after the first connection
  // attempt, so there is nothing here to subscribe to.
  const storage = getStorageStatus();

  React.useEffect(() => {
    void getAppVersion().then(setVersion);
    void getHelmsmanStatus().then(setHelmsman);
  }, []);

  /** What the manual check has to say for itself. */
  const report = (() => {
    if (!desktop) {
      return { icon: null, text: "Updates are checked by the desktop app." };
    }
    if (installing) {
      const percent = progress?.fraction != null ? Math.round(progress.fraction * 100) : null;
      return {
        icon: <Loader2 className="size-3.5 animate-spin text-primary" />,
        text: percent != null ? `Installing, ${percent}%` : "Installing…",
      };
    }
    if (status === "checking") {
      return { icon: <Loader2 className="size-3.5 animate-spin text-primary" />, text: "Checking…" };
    }
    if (status === "available" && available) {
      return {
        icon: <Download className="size-3.5 text-primary" />,
        text: `Pulse ${available.version} is available.`,
      };
    }
    if (status === "latest") {
      return { icon: <Check className="size-3.5 text-success" />, text: "You are on the latest version." };
    }
    if (status === "failed") {
      return { icon: null, text: "Could not check for updates. Try again later." };
    }
    return {
      icon: null,
      text: "Pulse checks once at launch, and you can ask again here.",
    };
  })();

  const busy = status === "checking" || installing;
  const percent = progress?.fraction != null ? Math.round(progress.fraction * 100) : null;

  return (
    <div className="space-y-5">
      <SectionIntro title="About">Version and where Pulse keeps things on this machine.</SectionIntro>

      <Card>
        <CardHeader>
          <CardTitle>This installation</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <DetailRow label="Pulse">{version ?? "-"}</DetailRow>
          <DetailRow label="Running as">{desktop ? "Desktop app" : "Browser preview"}</DetailRow>
          <DetailRow label="Settings file">~/.pulse/config.json</DetailRow>
          <DetailRow label="Library">
            <LibraryStatus mode={storage.mode} desktop={desktop} />
          </DetailRow>
          <DetailRow label="Item collection">
            {helmsman.path ? (
              <Badge variant="success" className="gap-1">
                helmsman {helmsman.version ?? "installed"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                not installed
              </Badge>
            )}
          </DetailRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Updates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            {report.icon}
            <span>{report.text}</span>
          </div>

          {installing && <Progress value={percent ?? undefined} />}

          <div className="flex flex-wrap items-center gap-2">
            {status === "available" && available && !installing ? (
              <Button size="sm" onClick={() => void install()} className="gap-1.5">
                <Download className="size-3.5" />
                Update to {available.version}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void check({ prompt: true })}
              disabled={busy || !desktop}
              className="gap-1.5"
            >
              <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
              Check for updates
            </Button>
          </div>

          <Hint>
            Updates are signed and verified against the key Pulse ships with, so only a release from this
            project can be installed.
          </Hint>
        </CardContent>
      </Card>

      {desktop && storage.mode === "browser" && (
        <Hint className="break-all">
          Pulse could not open its SQLite database, so everything is being kept in the browser store. That
          store is small and the system is free to clear it, so the library is not safe there. Reported error:{" "}
          {storage.error ?? "unknown"}.
        </Hint>
      )}
    </div>
  );
}

/**
 * Which store the app actually opened.
 *
 * This row used to state "pulse.db" unconditionally, which was wrong for as long
 * as SQLite could not be opened and every write was landing in the browser store.
 * Browser storage is only the correct answer for the browser preview.
 */
function LibraryStatus({ mode, desktop }: { mode: string; desktop: boolean }) {
  if (mode === "sqlite") {
    return (
      <Badge variant="success" className="gap-1">
        <Database className="size-3" />
        SQLite
      </Badge>
    );
  }

  if (!desktop) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        Browser storage
      </Badge>
    );
  }

  return (
    <Badge variant="destructive" className="gap-1">
      <TriangleAlert className="size-3" />
      Browser storage
    </Badge>
  );
}
