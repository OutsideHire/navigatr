import { describe, it, expect } from "vitest";
import { friendlyLogError } from "./friendlyLogError";

const DEAL_UNAVAILABLE = /no longer in your workspace/i;

describe("friendlyLogError", () => {
  it("maps a foreign-key failure (missing deal) to the deal-unavailable message", () => {
    expect(friendlyLogError({ code: "23503", message: 'violates foreign key constraint "activities_deal_id_fkey"' }))
      .toMatch(DEAL_UNAVAILABLE);
  });

  it("maps an RLS / org denial to the deal-unavailable message", () => {
    expect(friendlyLogError({ code: "42501", message: "new row violates row-level security policy" }))
      .toMatch(DEAL_UNAVAILABLE);
    expect(friendlyLogError({ code: "P0001", message: "activity org_id must match the deal" }))
      .toMatch(DEAL_UNAVAILABLE);
  });

  it("passes a real Error message through (e.g. Not signed in)", () => {
    expect(friendlyLogError(new Error("Not signed in"))).toBe("Not signed in");
  });

  it("falls back to the generic line for an unknown shape", () => {
    expect(friendlyLogError({ code: "23505", message: "some other unique violation" }))
      .toBe("Could not log activity");
    expect(friendlyLogError(null)).toBe("Could not log activity");
    expect(friendlyLogError("weird")).toBe("Could not log activity");
  });
});
