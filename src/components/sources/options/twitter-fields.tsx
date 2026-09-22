/** Options for the twitter source. */
import type { SourceConnection, SourceOptions } from "../../../lib/types";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { OptionFieldProps, splitList } from "./shared";

export function TwitterFields({ source, draft, onChange }: OptionFieldProps) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Source</Label>
        <Select
          value={draft.mode ?? "feed"}
          onValueChange={(value) => onChange({ mode: value as "feed" | "search" })}
        >
          <SelectTrigger className="h-8 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="feed">Home timeline</SelectItem>
            <SelectItem value="search">Keyword search</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(draft.mode ?? "feed") === "search" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${source.id}-keywords`} className="text-xs">
            Keywords
          </Label>
          <Input
            id={`${source.id}-keywords`}
            placeholder="deepseek, LLM inference"
            defaultValue={(draft.queries ?? []).join(", ")}
            onChange={(event) => onChange({ queries: splitList(event.target.value) })}
            className="h-8 text-[13px]"
          />
          <p className="text-[11px] text-muted-foreground">Comma separated, up to 5.</p>
        </div>
      )}
    </>
  );
}
