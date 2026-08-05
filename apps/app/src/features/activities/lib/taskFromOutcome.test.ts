import { describe, it, expect } from "vitest";
import { taskFromOutcome } from "./taskFromOutcome";
import { bandsFromTarget } from "./taskBands";
import { DISPOSITIONS } from "@/lib/followUpScheduling";

// The stored follow-up date (activities.follow_up_date) is the target.
const TARGET = "2026-08-10";

describe("taskFromOutcome", () => {
  it("builds task fields around the stored target date, inheriting the activity type", () => {
    const interval = DISPOSITIONS.positive_engagement.businessDays;
    expect(interval).not.toBeNull(); // guard: fixture assumption
    const result = taskFromOutcome("drop_in", "positive_engagement", TARGET, "Acme Co");
    const bands = bandsFromTarget(TARGET, interval);
    expect(result).toEqual({
      type: "drop_in",
      title: "Acme Co",
      date_source: "interval",
      ...bands!,
      original_target_at: TARGET,
      source_outcome: "positive_engagement",
    });
  });

  it("keeps target_at == original_target_at == the stored date (score-stability contract)", () => {
    const r = taskFromOutcome("call", "positive_engagement", TARGET, "Acme Co")!;
    expect(r.target_at).toBe(TARGET);
    expect(r.original_target_at).toBe(TARGET);
  });

  it("returns null when there is no stored follow-up date", () => {
    expect(taskFromOutcome("call", "positive_engagement", null, "Acme Co")).toBeNull();
  });

  it("returns null for a terminal outcome with no interval", () => {
    expect(DISPOSITIONS.not_interested.businessDays).toBeNull(); // guard
    expect(taskFromOutcome("call", "not_interested", TARGET, "Acme Co")).toBeNull();
  });
});
