/** Options for the github source. */
import type { SourceConnection, SourceOptions } from "../../../lib/types";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import { OptionFieldProps } from "./shared";

export function GithubFields({ source, draft, onChange }: OptionFieldProps) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${source.id}-language`} className="text-xs">
          Language
        </Label>
        <Input
          id={`${source.id}-language`}
          placeholder="Rust, Python, TypeScript"
          defaultValue={draft.language ?? ""}
          onChange={(event) => onChange({ language: event.target.value })}
          className="h-8 text-[13px]"
        />
        <p className="text-[11px] text-muted-foreground">Blank includes every language.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${source.id}-days`} className="text-xs">
          Created within (days)
        </Label>
        <Input
          id={`${source.id}-days`}
          type="number"
          min={1}
          max={90}
          placeholder="7"
          defaultValue={draft.days ?? 7}
          onChange={(event) => onChange({ days: Number(event.target.value) })}
          className="h-8 text-[13px]"
        />
      </div>
    </>
  );
}
