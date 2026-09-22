/**
 * One row in the source list: the domain, its status dot, and how many sources
 * sit behind it.
 */
import { cn } from "../../lib/utils";
import type { SourceGroup } from "../../lib/sources/grouping";
import { groupStatus, TONE_DOT } from "./status";

export function GroupRow({
  group,
  active,
  onSelect,
}: {
  group: SourceGroup;
  active: boolean;
  onSelect: () => void;
}) {
  const status = groupStatus(group.sources);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-secondary" : "hover:bg-accent"
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[status.tone])} aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate text-[13px] text-foreground", active && "font-medium")}>
          {group.label}
        </span>
        {group.sources.length > 1 && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {group.sources.length}
          </span>
        )}
      </span>
      <span className="truncate pl-3.5 text-[11px] text-muted-foreground">{group.domain}</span>
    </button>
  );
}
