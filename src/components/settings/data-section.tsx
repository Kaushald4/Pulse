"use client";

import React from "react";
import { Trash2, Upload, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Hint, SectionIntro } from "./shared";
import { usePulse } from "../../store/pulse";

export function DataSection({ desktop }: { desktop: boolean }) {
  const wipeData = usePulse((state) => state.wipeData);
  const exportLibrary = usePulse((state) => state.exportLibrary);
  const importLibrary = usePulse((state) => state.importLibrary);

  return (
    <div className="space-y-5">
      <SectionIntro title="Data">
        Everything Pulse collects stays on this machine in a single local database. Nothing is uploaded
        anywhere.
      </SectionIntro>

      <Card>
        <CardHeader>
          <CardTitle>Back up and restore</CardTitle>
          <CardDescription>
            Export writes a portable copy of your items, sources and briefings. Import merges one back in
            &mdash; it adds and updates, it never deletes what you already have.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void exportLibrary()} disabled={!desktop} className="gap-1.5">
            <Upload className="size-3.5" />
            Export a copy
          </Button>
          <Button variant="outline" onClick={() => void importLibrary()} disabled={!desktop} className="gap-1.5">
            <Download className="size-3.5" />
            Import from a file
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reset</CardTitle>
          <CardDescription>
            Clears every collected item, source status and briefing. Your providers and model choices are kept.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm("Delete all collected items, source status and briefings? This cannot be undone.")) {
                void wipeData();
              }
            }}
            className="gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Erase everything
          </Button>
          <Hint>
            Changes apply immediately - this is not part of the save bar, because there is nothing to undo.
          </Hint>
        </CardContent>
      </Card>
    </div>
  );
}
