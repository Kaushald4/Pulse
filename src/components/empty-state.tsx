import type { ComponentType, ReactNode } from "react";
import { cn } from "../lib/utils";

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-transparent px-6 py-12 text-center",
        className
      )}
    >
      <Icon className="size-5 text-muted-foreground/70" />
      <div className="max-w-sm space-y-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <div className="text-[13px] leading-5 text-muted-foreground">{description}</div>
      </div>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
