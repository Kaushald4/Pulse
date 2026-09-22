/** Options for the devto source. */
import type { SourceConnection, SourceOptions } from "../../../lib/types";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import { OptionFieldProps } from "./shared";

export function DevToFields({ source, draft, onChange }: OptionFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${source.id}-tag`} className="text-xs">
        Tag
      </Label>
      <Input
        id={`${source.id}-tag`}
        placeholder="ai"
        defaultValue={draft.tag ?? ""}
        onChange={(event) => onChange({ tag: event.target.value })}
        className="h-8 text-[13px]"
      />
    </div>
  );
}
