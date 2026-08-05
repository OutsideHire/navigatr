import { describe, it, expect } from "vitest";
import { taskFromOutcome } from "./taskFromOutcome";
import { deriveBands } from "./taskBands";
import { DISPOSITIONS } from "@/lib/followUpScheduling";

const OCC = "2026-08-03T09:00:00Z";

describe("taskFromOutcome", () => {
  it("maps an outcome with an interval to task fields, inheriting the activity type", () => {
    const interval = DISPOSITIONS.positive_engagement.businessDays;
    expect(interval).not.toBeNull(); // guard: fixture assumption
    const result = taskFromOutcome("drop_in", "positive_engagement", OCC, "Acme Co");
    const bands = deriveBands(OCC, interval);
    expect(result).toEqual({
      type: "drop_in",
      title: "Acme Co",
      date_source: "interval",
      ...bands!,
      original_target_at: bands!.target_at,
      source_outcome: "positive_engagement",
    });
  });

  it("sets original_target_at equal to target_at at creation", () => {
    const r = taskFromOutcome("call", "positive_engagement", OCC, "Acme Co")!;
    expect(r.original_target_at).toBe(r.target_at);
  });

  it("returns null for a terminal outcome with no interval", () => {
    expect(DISPOSITIONS.not_interested.businessDays).toBeNull(); // guard
    expect(taskFromOutcome("call", "not_interested", OCC, "Acme Co")).toBeNull();
  });
});
