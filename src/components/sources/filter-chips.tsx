/** The filters a source actually collects with, as chips. */
import { Chip } from "../chip";
import { sourceFilterChips } from "../../lib/sources/grouping";
import type { SourceConnection } from "../../lib/types";

/** The applied defaults, as chips - what this source actually collects. */
export function FilterChips({ source }: { source: SourceConnection }) {
  const chips = sourceFilterChips(source);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <Chip key={chip} label={chip} />
      ))}
    </div>
  );
}
