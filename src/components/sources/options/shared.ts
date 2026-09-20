import type { SourceConnection, SourceOptions } from "../../../lib/types";

/** What every per-source option field component receives. */
export interface OptionFieldProps {
  source: SourceConnection;
  draft: SourceOptions;
  onChange: (patch: SourceOptions) => void;
}

/** Splits a comma-separated input into a clean list. */
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
