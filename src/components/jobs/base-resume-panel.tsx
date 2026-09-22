"use client";

import React from "react";
import { FileText, Upload } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useJobs } from "../../store/jobs";
import { formatRelativeTime } from "../../lib/utils";

/**
 * The one active base resume every prompt reads. Uploading a new one replaces
 * it; the old text isn't kept.
 */
export function BaseResumePanel() {
  const resume = useJobs((state) => state.resume);
  const uploadResume = useJobs((state) => state.uploadResume);
  const [busy, setBusy] = React.useState(false);

  const upload = async () => {
    setBusy(true);
    try {
      await uploadResume();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          {resume ? (
            <>
              <p className="truncate text-[13px] font-medium text-foreground">{resume.fileName}</p>
              <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                Base resume · uploaded {formatRelativeTime(resume.uploadedAt)}
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium text-foreground">No base resume yet</p>
              <p className="text-[12px] text-muted-foreground">
                Upload one to unlock fit scoring, tailored resumes and cover letters.
              </p>
            </>
          )}
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => void upload()}
        disabled={busy}
        className="shrink-0 gap-1.5"
      >
        <Upload className="size-3.5" />
        {busy ? "Reading…" : resume ? "Replace" : "Upload resume"}
      </Button>
    </Card>
  );
}
