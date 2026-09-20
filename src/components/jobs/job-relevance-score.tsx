"use client";

import { Chip } from "../chip";
import { cn } from "../../lib/utils";

/** How a score reads at a glance, so the number isn't the only signal. */
export function scoreTier(score: number): { label: string; tone: "success" | "warning" | "danger" } {
  if (score >= 75) return { label: "Strong match", tone: "success" };
  if (score >= 45) return { label: "Possible match", tone: "warning" };
  return { label: "Weak match", tone: "danger" };
}

export function JobRelevanceScore({
  score,
  reasoning,
  className,
}: {
  score: number | null;
  reasoning: string | null;
  className?: string;
}) {
  if (score === null) {
    return <span className={cn("text-[12px] italic text-muted-foreground", className)}>Not scored yet</span>;
  }

  const tier = scoreTier(score);
  return (
    <span className={cn("flex items-center gap-2", className)} title={reasoning ?? undefined}>
      <Chip label={`${score}%`} tone={tier.tone} />
      <span className="text-[11px] text-muted-foreground">{tier.label}</span>
    </span>
  );
}
