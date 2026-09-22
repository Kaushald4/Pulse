"use client";

import React from "react";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

/** Labelled text input with an optional hint line. */
export function Field({
  label,
  hint,
  className,
  ...props
}: { label: string; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      <Input {...props} />
      {hint && <span className="block text-[11px] leading-relaxed text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Quiet explanatory copy. */
export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[11px] leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

/** Title + one-line explanation at the top of a settings pane. */
export function SectionIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="max-w-[60ch] text-[13px] leading-5 text-muted-foreground">{children}</p>
    </div>
  );
}

/** Read-only key/value row. */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right font-mono text-[11px] text-foreground">{children}</span>
    </div>
  );
}

/** Environment variables that override a field, shown as secondary detail. */
export function EnvHint({ names }: { names: string[] }) {
  return (
    <span className="block text-[11px] leading-relaxed text-muted-foreground">
      Overridden by <span className="font-mono">{names.join(", ")}</span> when set.
    </span>
  );
}
