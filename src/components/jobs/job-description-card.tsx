"use client";

import React from "react";
import { CloudDownload, Pencil } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Textarea } from "../ui/textarea";
import { useJobs } from "../../store/jobs";
import { cn } from "../../lib/utils";

/**
 * Board and ATS feeds rarely include a description, so this is both the place
 * to pull one off the listing's own page and to paste one in by hand.
 */
export function JobDescriptionCard() {
  const job = useJobs((state) => state.job);
  const busy = useJobs((state) => state.busy);
  const saveDescription = useJobs((state) => state.saveDescription);
  const fetchDescription = useJobs((state) => state.fetchDescription);

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const fetching = busy === "description";

  React.useEffect(() => {
    setDraft(job?.description ?? "");
    setEditing(!job?.description);
  }, [job?.id, job?.description]);

  if (!job) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="text-sm">Description</CardTitle>
        <div className="flex shrink-0 items-center gap-1">
          {!editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
              <Pencil className="size-3.5" />
              Edit
            </Button>
          )}
          {job.jobUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchDescription()}
              disabled={fetching}
              className="gap-1.5"
            >
              <CloudDownload className={cn("size-3.5", fetching && "animate-pulse")} />
              {fetching ? "Fetching…" : "Fetch from listing"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {editing ? (
          <>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={12}
              placeholder="Paste the job description…"
              className="text-[13px]"
            />
            {!job.description && (
              <p className="text-[11px] text-muted-foreground">
                These feeds usually ship without a description - fetch it from the listing, or paste it in.
                Scoring, resumes and cover letters all read it.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!draft.trim()}
                onClick={() => {
                  void saveDescription(draft);
                  setEditing(false);
                }}
              >
                Save
              </Button>
              {job.description && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(job.description ?? "");
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="whitespace-pre-line text-[13px] leading-6 text-muted-foreground">{job.description}</p>
        )}
      </CardContent>
    </Card>
  );
}
