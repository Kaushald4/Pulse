"use client";

import React from "react";
import { Download, FileText, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Chip } from "../chip";
import { GeneratedResumeEditor } from "./generated-resume-editor";
import { useJobs } from "../../store/jobs";
import type { GeneratedResume } from "../../lib/jobs/types";
import { cn, formatRelativeTime } from "../../lib/utils";

export function JobResumeCard() {
  const resume = useJobs((state) => state.resume);
  const drafts = useJobs((state) => state.drafts);
  const busy = useJobs((state) => state.busy);
  const generateResume = useJobs((state) => state.generateResume);
  const downloadResume = useJobs((state) => state.downloadResume);
  const removeResume = useJobs((state) => state.removeResume);

  const [editing, setEditing] = React.useState<GeneratedResume | null>(null);
  const generating = busy === "resume-write";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="text-sm">Tailored resume</CardTitle>
        <Button
          size="sm"
          onClick={() => void generateResume()}
          disabled={generating || !resume}
          className="gap-1.5"
        >
          <Sparkles className={cn("size-3.5", generating && "animate-pulse")} />
          {generating ? "Generating…" : "Generate"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!resume && <p className="text-[12px] text-muted-foreground">Upload a base resume first.</p>}

        {drafts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing generated yet. Each generation is kept, so you can compare drafts.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {drafts.map((draft) => (
              <div key={draft.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-foreground">{draft.fileName}</p>
                    <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                      {formatRelativeTime(draft.generatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(draft)} className="gap-1.5">
                    <Pencil className="size-3.5" />
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Download ${draft.fileName}`}
                    title="Download .docx"
                    onClick={() => void downloadResume(draft)}
                    className="size-8 text-muted-foreground"
                  >
                    <Download className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${draft.fileName}`}
                    title="Delete"
                    onClick={() => {
                      if (window.confirm("Delete this generated resume? This can't be undone.")) {
                        void removeResume(draft.id);
                      }
                    }}
                    className="size-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {drafts.length > 0 && <Chip label={`${drafts.length} version${drafts.length === 1 ? "" : "s"}`} />}
      </CardContent>

      <GeneratedResumeEditor
        draft={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </Card>
  );
}
