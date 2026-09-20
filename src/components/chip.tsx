"use client";

import React from "react";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { SOURCE_LABELS, labelFor, type Tone } from "../lib/taxonomy";

/**
 * Solid, filled badges. Tone is the only thing that changes colour: neutral
 * (filled with the secondary surface) for every label, and a semantic fill for
 * actual status. No per-category hues, so nothing has to be decoded.
 */
const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive text-destructive-foreground",
};

export function Chip({
  label,
  tone = "neutral",
  icon: Icon,
  className,
  title,
}: {
  label: string;
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  title?: string;
}) {
  return (
    <Badge
      title={title}
      className={cn(
        "gap-1 border-transparent px-2 py-0.5 text-[11px] font-medium shadow-none hover:opacity-100",
        TONE_CLASS[tone],
        className
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {label}
    </Badge>
  );
}

export function SourceChip({ source }: { source: string }) {
  return <Chip label={SOURCE_LABELS[source] ?? labelFor({}, source)} />;
}
