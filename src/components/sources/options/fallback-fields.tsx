/** Options for any source without its own fields. */
import type { SourceConnection, SourceOptions } from "../../../lib/types";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import { OptionFieldProps } from "./shared";

export function FallbackFields({ source, draft, onChange }: OptionFieldProps) {
  return (
  <div className="space-y-1.5">
    <Label htmlFor={`${source.id}-limit`} className="text-xs">
      Items per sync
    </Label>
    <Input
      id={`${source.id}-limit`}
      type="number"
      min={1}
      max={50}
      placeholder="15"
      defaultValue={draft.limit ?? undefined}
      onChange={(event) => onChange({ limit: Number(event.target.value) })}
      className="h-8 text-[13px]"
    />
  </div>
  );
}
