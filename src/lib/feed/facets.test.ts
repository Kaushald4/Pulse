import { describe, expect, it } from "vitest";
import { WINDOWS, windowSince } from "./facets";
import { startOfToday } from "../utils";

describe("windowSince", () => {
  const now = new Date("2026-06-15T14:30:00.000Z");

  it("means all time when asked for all time", () => {
    expect(windowSince("all", now)).toBeUndefined();
  });

  it("uses local midnight for today, not a rolling day", () => {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    expect(windowSince("today", now)).toBe(midnight.toISOString());

    // Deliberately an hour wide, not "whatever the clock says".
    expect(new Date(windowSince("today", now)!).getHours()).toBe(0);
  });

  it("counts back from now for the rolling windows", () => {
    expect(windowSince("day", now)).toBe("2026-06-14T14:30:00.000Z");
    expect(windowSince("week", now)).toBe("2026-06-08T14:30:00.000Z");
  });

  /** The store and the facets must agree on what "today" means, or the count lies. */
  it("matches the shared definition of the start of today", () => {
    expect(windowSince("today")).toBe(startOfToday());
  });

  it("orders the windows from narrowest to widest", () => {
    expect(WINDOWS.map((window) => window.value)).toEqual(["today", "day", "week", "all"]);
  });
});
