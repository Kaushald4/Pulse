/** Options for the arxiv source. */
import type { SourceConnection, SourceOptions } from "../../../lib/types";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import { OptionFieldProps } from "./shared";

export function ArxivFields({ source, draft, onChange }: OptionFieldProps) {
  return (
  <div className="space-y-1.5">
    <Label htmlFor={`${source.id}-category`} className="text-xs">
      Category
    </Label>
    <Input
      id={`${source.id}-category`}
      placeholder="cs.AI"
      defaultValue={draft.category ?? ""}
      onChange={(event) => onChange({ category: event.target.value })}
      className="h-8 text-[13px]"
    />
    <p className="text-[11px] text-muted-foreground">e.g. cs.AI, cs.LG, cs.CL, stat.ML</p>
  </div>
  );
}
