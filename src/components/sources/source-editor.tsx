/**
 * The per-source option editor. Edits are held in a local draft and only
 * written when saved, so a half-typed keyword list never reaches the fetcher.
 */
import React from "react";
import { Button } from "../ui/button";
import { usePulse } from "../../store/pulse";
import type { SourceConnection, SourceOptions } from "../../lib/types";
import { OptionFields } from "./options";
import type { OptionFieldProps } from "./options/shared";

export function SourceEditor({ source }: { source: SourceConnection }) {
  const sources = usePulse((state) => state.sources);
  const updateSourceOptions = usePulse((state) => state.updateSourceOptions);
  const [draft, setDraft] = React.useState<SourceOptions>(source.options ?? {});

  React.useEffect(() => {
    setDraft(sources.find((entry) => entry.id === source.id)?.options ?? {});
  }, [sources, source.id]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(source.options ?? {});

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <OptionFields source={source} draft={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void updateSourceOptions(source.id, draft)} disabled={!dirty}>
          Save settings
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(source.options ?? {})}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}
