/** Options for the lobsters source. */
import type { SourceConnection, SourceOptions } from "../../../lib/types";
import { Label } from "../../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { OptionFieldProps } from "./shared";

export function LobstersFields({ source, draft, onChange }: OptionFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Sort</Label>
      <Select value={draft.sort ?? "hottest"} onValueChange={(value) => onChange({ sort: value })}>
        <SelectTrigger className="h-8 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hottest">Hottest</SelectItem>
          <SelectItem value="newest">Newest</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
