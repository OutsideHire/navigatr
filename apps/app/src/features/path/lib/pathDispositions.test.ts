import { describe, it, expect } from "vitest";
import { PATH_DISPOSITION_KEYS, isEngagedDisposition } from "./pathDispositions";

describe("path dispositions", () => {
  it("lists the 10 redesigned dispositions in screenshot order", () => {
    expect(PATH_DISPOSITION_KEYS).toEqual([
      "statement_secured","positive_engagement","connected_with_dm",
      "dm_unavailable","followup_requested","future_potential",
      "low_probability","wrong_number","not_interested","closed_lost",
    ]);
  });
  it("treats any disposition that schedules a follow-up as engaged (creates a deal)", () => {
    for (const d of ["statement_secured","positive_engagement","connected_with_dm","dm_unavailable","followup_requested","future_potential","low_probability"] as const) {
      expect(isEngagedDisposition(d)).toBe(true);
    }
    for (const d of ["wrong_number","not_interested","closed_lost"] as const) {
      expect(isEngagedDisposition(d)).toBe(false);
    }
  });
});
