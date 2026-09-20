"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { DetailRow, Hint, SectionIntro } from "./shared";
import { EMPTY_HELMSMAN_STATUS, getAppVersion, getHelmsmanStatus, type HelmsmanStatus } from "../../lib/config";
import { usePulse } from "../../store/pulse";

export function AboutSection() {
  const desktop = usePulse((state) => state.desktop);
  const [version, setVersion] = React.useState<string | null>(null);
  const [helmsman, setHelmsman] = React.useState<HelmsmanStatus>(EMPTY_HELMSMAN_STATUS);

  React.useEffect(() => {
    void getAppVersion().then(setVersion);
    void getHelmsmanStatus().then(setHelmsman);
  }, []);

  return (
    <div className="space-y-5">
      <SectionIntro title="About">
        Version and where Pulse keeps things on this machine.
      </SectionIntro>

      <Card>
        <CardHeader>
          <CardTitle>This installation</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <DetailRow label="Pulse">{version ?? "-"}</DetailRow>
          <DetailRow label="Running as">{desktop ? "Desktop app" : "Browser preview"}</DetailRow>
          <DetailRow label="Settings file">~/.pulse/config.json</DetailRow>
          <DetailRow label="Library">pulse.db</DetailRow>
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

      {helmsman.path && (
        <Hint className="break-all font-mono">{helmsman.path}</Hint>
      )}
    </div>
  );
}
