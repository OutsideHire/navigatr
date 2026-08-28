import { describe, it, expect } from "vitest";
import { outcomeFollowUpMeta } from "./outcomeFollowUpMeta";

describe("outcomeFollowUpMeta", () => {
  it("labels a fixed-interval green outcome with its day count in the success tone", () => {
    expect(outcomeFollowUpMeta("statement_secured")).toEqual({ label: "1-day follow-up", tone: "success" });
    expect(outcomeFollowUpMeta("met_dm")).toEqual({ label: "3-day follow-up", tone: "success" });
  });

  it("labels a fixed-interval amber outcome with its day count in the warning tone", () => {
    expect(outcomeFollowUpMeta("gatekeeper")).toEqual({ label: "3-day follow-up", tone: "warning" });
    expect(outcomeFollowUpMeta("left_collateral")).toEqual({ label: "5-day follow-up", tone: "warning" });
    expect(outcomeFollowUpMeta("not_in_office")).toEqual({ label: "2-day follow-up", tone: "warning" });
    expect(outcomeFollowUpMeta("closed_locked")).toEqual({ label: "30-day follow-up", tone: "warning" });
  });

  it("marks the rep-chosen outcome as 'You pick the date' in the accent tone", () => {
    // scheduled_callback carries a 2-day interval underneath, but the owner
    // named a time so the rep sets the date — never show the fallback interval.
    expect(outcomeFollowUpMeta("scheduled_callback")).toEqual({ label: "You pick the date", tone: "accent" });
  });

  it("marks a terminal outcome (no interval) as 'No follow-up' in the muted tone", () => {
    expect(outcomeFollowUpMeta("do_not_contact")).toEqual({ label: "No follow-up", tone: "muted" });
    expect(outcomeFollowUpMeta("out_of_business")).toEqual({ label: "No follow-up", tone: "muted" });
  });
});
