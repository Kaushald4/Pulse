"use client";

import { Mail, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useJobs } from "../../store/jobs";
import { COVER_LETTER_TONES, type CoverLetterTone } from "../../lib/jobs/types";
import { cn, formatRelativeTime } from "../../lib/utils";

const TONE_LABELS: Record<CoverLetterTone, string> = {
  standard: "Standard",
  professional: "Professional",
  academic: "Academic",
  casual: "Casual",
};

export function JobCoverLetterCard() {
  const resume = useJobs((state) => state.resume);
  const letters = useJobs((state) => state.letters);
  const busy = useJobs((state) => state.busy);
  const generateLetter = useJobs((state) => state.generateLetter);
  const rewriteLetter = useJobs((state) => state.rewriteLetter);

  const working = busy === "letter";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="text-sm">Cover letter</CardTitle>
        <Button
          size="sm"
          onClick={() => void generateLetter()}
          disabled={working || !resume}
          className="gap-1.5"
        >
          <Mail className={cn("size-3.5", working && "animate-pulse")} />
          {working ? "Working…" : "Generate"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!resume && <p className="text-[12px] text-muted-foreground">Upload a base resume first.</p>}

        {letters.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing written yet. Rewrites are kept alongside the original.
          </p>
        ) : (
          letters.map((letter) => (
            <div key={letter.id} className="space-y-2 rounded-lg border border-border p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {letter.tone && <Badge variant="secondary">{TONE_LABELS[letter.tone as CoverLetterTone] ?? letter.tone}</Badge>}
                  <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                    {formatRelativeTime(letter.generatedAt)}
                  </span>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" disabled={working} className="gap-1.5">
                      <RefreshCw className="size-3.5" />
                      Rewrite
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {COVER_LETTER_TONES.map((tone) => (
                      <DropdownMenuItem key={tone} onSelect={() => void rewriteLetter(letter.id, tone)}>
                        {TONE_LABELS[tone]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <p className="whitespace-pre-wrap text-[13px] leading-6 text-foreground/90">
                {letter.content}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
