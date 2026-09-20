/** Options for the reddit source. */
import type { SourceConnection, SourceOptions } from "../../../lib/types";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { OptionFieldProps, splitList } from "./shared";

export function RedditFields({ source, draft, onChange }: OptionFieldProps) {
  return (
  <>
    <div className="space-y-1.5">
      <Label htmlFor={`${source.id}-subreddits`} className="text-xs">
        Subreddits
      </Label>
      <Input
        id={`${source.id}-subreddits`}
        placeholder="localllama, MachineLearning"
        defaultValue={(draft.subreddits ?? []).join(", ")}
        onChange={(event) => onChange({ subreddits: splitList(event.target.value) })}
        className="h-8 text-[13px]"
      />
      <p className="text-[11px] text-muted-foreground">
        Comma separated, up to 12. Each one is a separate extraction run.
      </p>
    </div>
    <div className="space-y-1.5">
      <Label className="text-xs">Sort</Label>
      <Select value={draft.sort ?? "hot"} onValueChange={(value) => onChange({ sort: value })}>
        <SelectTrigger className="h-8 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hot">Hot</SelectItem>
          <SelectItem value="new">New</SelectItem>
          <SelectItem value="top">Top</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </>
  );
}
