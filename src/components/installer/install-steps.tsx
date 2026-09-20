"use client";

import { AlertCircle, Check, CircleDashed, Loader2, MinusCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import type { SetupStep } from "../../lib/setup";

export type StepState = "pending" | "running" | "ready" | "installed" | "failed" | "skipped";

const LABELS: Record<StepState, string | null> = {
  pending: "Waiting",
  running: "Installing",
  ready: "Installed",
  installed: "Installed",
  failed: "Failed",
  skipped: "Not installed",
};

function StepIcon({ state }: { state: StepState }) {
  if (state === "running") {
    return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
  }
  if (state === "ready" || state === "installed") {
    return <Check className="size-4 text-success" aria-hidden />;
  }
  if (state === "failed") {
    return <AlertCircle className="size-4 text-destructive" aria-hidden />;
  }
  if (state === "skipped") {
    return <MinusCircle className="size-4 text-muted-foreground/60" aria-hidden />;
  }
  return <CircleDashed className="size-4 text-muted-foreground/40" aria-hidden />;
}

/** The component checklist, showing what is present and what is being fetched. */
export function InstallSteps({
  steps,
  states,
  errors,
}: {
  steps: SetupStep[];
  states: Record<string, StepState>;
  errors: Record<string, string>;
}) {
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/60">
      {steps.map((step) => {
        const state = states[step.id] ?? (step.ready ? "ready" : "pending");
        const failed = state === "failed";

        return (
          <li key={step.id} className="flex items-start gap-3 px-3.5 py-3">
            <span className="mt-0.5 shrink-0">
              <StepIcon state={state} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span
                  className={cn(
                    "text-[13px] font-medium",
                    failed ? "text-destructive" : "text-foreground"
                  )}
                >
                  {step.title}
                </span>
                {!step.required && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    optional
                  </span>
                )}
                {step.version && (
                  <span className="font-mono text-[11px] text-muted-foreground">{step.version}</span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{step.detail}</p>
              {errors[step.id] && (
                <p className="mt-1 break-words text-[12px] leading-4 text-destructive">
                  {errors[step.id]}
                </p>
              )}
            </div>

            <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
              {LABELS[state]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
