import type { ComponentType } from "react";
import { cn } from "../lib/utils";

interface StatTileProps {
  value: number | string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hint?: string;
  className?: string;
}

/** Metric tile: large tabular value, quiet label, understated icon. */
export function StatTile({ value, label, icon: Icon, hint, className }: StatTileProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3.5",
        className
      )}
    >
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
          {value}
        </div>
        <div className="mt-2 text-xs leading-snug text-muted-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{hint}</div>}
      </div>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
