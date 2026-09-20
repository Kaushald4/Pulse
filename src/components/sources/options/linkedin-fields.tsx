/** Options for the linkedin source. */
import type { SourceConnection, SourceOptions } from "../../../lib/types";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import { OptionFieldProps } from "./shared";

export function LinkedInFields({ source, draft, onChange }: OptionFieldProps) {
  return (
  <>
    <div className="space-y-1.5">
      <Label htmlFor={`${source.id}-keywords`} className="text-xs">
        Job keywords
      </Label>
      <Input
        id={`${source.id}-keywords`}
        placeholder="AI Engineer"
        defaultValue={draft.keywords ?? ""}
        onChange={(event) => onChange({ keywords: event.target.value })}
        className="h-8 text-[13px]"
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor={`${source.id}-location`} className="text-xs">
        Location
      </Label>
      <Input
        id={`${source.id}-location`}
        placeholder="Remote"
        defaultValue={draft.location ?? ""}
        onChange={(event) => onChange({ location: event.target.value })}
        className="h-8 text-[13px]"
      />
    </div>
  </>
  );
}
