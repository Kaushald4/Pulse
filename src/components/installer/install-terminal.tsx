"use client";

import React from "react";
import { cn } from "../../lib/utils";
import type { SetupPhase } from "../../lib/setup";

export interface TerminalLine {
  id: number;
  step: string;
  phase: SetupPhase;
  text: string;
}

const TONE: Record<SetupPhase, string> = {
  start: "text-primary",
  line: "text-muted-foreground",
  done: "text-success",
  failed: "text-destructive",
  skip: "text-muted-foreground/70",
};

const GLYPH: Record<SetupPhase, string> = {
  start: "→",
  line: " ",
  done: "✓",
  failed: "✗",
  skip: "•",
};

/** The raw output of whatever is being installed, as it arrives. */
export function InstallTerminal({ lines, running }: { lines: TerminalLine[]; running: boolean }) {
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  return (
    <div className="flex h-56 flex-col overflow-hidden rounded-xl border border-border/60 bg-black/50">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-3 py-2">
        <span className="size-2.5 rounded-full bg-destructive/70" aria-hidden />
        <span className="size-2.5 rounded-full bg-warning/70" aria-hidden />
        <span className="size-2.5 rounded-full bg-success/70" aria-hidden />
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
          {running ? "installing…" : "setup log"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-5">
        {lines.length === 0 ? (
          <p className="text-muted-foreground/70">
            {running ? "Starting…" : "Nothing to install - everything is already in place."}
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="flex gap-2 whitespace-pre-wrap break-words">
              <span className="shrink-0 text-muted-foreground/40 select-none">
                {GLYPH[line.phase]}
              </span>
              <span className={cn("min-w-0 flex-1", TONE[line.phase])}>{line.text}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
