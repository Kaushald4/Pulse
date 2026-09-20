"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { JobRelevanceScore } from "./job-relevance-score";
import { useJobs } from "../../store/jobs";
import { cn } from "../../lib/utils";

export function JobRelevanceCard() {
  const job = useJobs((state) => state.job);
  const busy = useJobs((state) => state.busy);
  const rescore = useJobs((state) => state.rescore);

  if (!job) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="text-sm">Fit</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void rescore()}
          disabled={busy === "score" || !job.description}
          className="gap-1.5"
        >
          <RefreshCw className={cn("size-3.5", busy === "score" && "animate-spin")} />
          {busy === "score" ? "Scoring…" : "Rescore"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <JobRelevanceScore score={job.relevanceScore} reasoning={job.relevanceReasoning} />
        {job.relevanceReasoning && (
          <p className="text-[13px] leading-5 text-muted-foreground">{job.relevanceReasoning}</p>
        )}
        {!job.description && (
          <p className="text-[12px] text-muted-foreground">
            Add a description first - scoring reads it against your base resume.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
