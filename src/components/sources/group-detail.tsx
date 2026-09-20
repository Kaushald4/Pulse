/**
 * A domain with more than one source: they share the panel, each still
 * syncable and editable on its own.
 */
import React from "react";
import { Pencil, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Chip } from "../chip";
import { cn } from "../../lib/utils";
import { sourceFilterChips, type SourceGroup } from "../../lib/sources/grouping";
import { usePulse } from "../../store/pulse";
import type { SourceConnection } from "../../lib/types";
import { FilterChips } from "./filter-chips";
import { SourceEditor } from "./source-editor";
import { StatusBadge, groupStatus } from "./status";

function GroupMember({ source }: { source: SourceConnection }) {
  const syncing = usePulse((state) => state.syncing);
  const syncingSource = usePulse((state) => state.syncingSource);
  const syncOne = usePulse((state) => state.syncOne);
  const [editing, setEditing] = React.useState(false);

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="text-[13px] font-medium text-foreground">{source.name}</div>
          <FilterChips source={source} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setEditing((value) => !value)} className="gap-1.5">
            <Pencil className="size-3" />
            {editing ? "Done" : "Edit"}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label={`Sync ${source.name}`}
            disabled={syncing}
            onClick={() => void syncOne(source.id)}
            className="size-8"
          >
            <RefreshCw className={cn("size-3.5", syncingSource === source.id && "animate-spin")} />
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 border-t border-border pt-4">
          <SourceEditor source={source} />
        </div>
      )}
    </div>
  );
}

/** A domain with several sources: one entry, all of them together. */
export function DomainGroupDetail({ group }: { group: SourceGroup }) {
  const syncing = usePulse((state) => state.syncing);
  const syncGroup = usePulse((state) => state.syncGroup);

  const chips = Array.from(new Set(group.sources.flatMap((source) => sourceFilterChips(source))));

  return (
    <Card className="flex flex-col gap-0 overflow-hidden p-0">
      <div className="space-y-3 border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{group.label}</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {group.domain} · {group.sources.length} sources
            </p>
          </div>
          <StatusBadge status={groupStatus(group.sources)} />
        </div>

        <Button
          size="sm"
          onClick={() => void syncGroup(group.sources.map((source) => source.id))}
          disabled={syncing}
          className="gap-1.5"
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : `Sync all ${group.sources.length}`}
        </Button>

        <div className="space-y-3 pt-1">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Default filters
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Chip key={chip} label={chip} />
            ))}
          </div>
        </div>
      </div>

      <div className="divide-y divide-border">
        {group.sources.map((source) => (
          <GroupMember key={source.id} source={source} />
        ))}
      </div>
    </Card>
  );
}
