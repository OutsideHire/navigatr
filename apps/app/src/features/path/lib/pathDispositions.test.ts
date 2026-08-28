import { describe, it, expect } from "vitest";
import { PATH_DISPOSITION_KEYS, isEngagedDisposition } from "./pathDispositions";

describe("path dispositions", () => {
  it("lists the field drop-in outcomes in the desired order", () => {
    expect(PATH_DISPOSITION_KEYS).toEqual([
      "statement_secured", "met_dm", "scheduled_callback",
      "gatekeeper", "left_collateral", "not_in_office",
      "closed_locked", "do_not_contact", "out_of_business",
    ]);
  });
  it("treats any outcome that schedules a follow-up as engaged (creates a deal)", () => {
    // Every outcome with a follow-up interval creates a deal; only the two
    // terminal Red outcomes (do_not_contact, out_of_business) do not.
    for (const d of ["statement_secured","met_dm","scheduled_callback","gatekeeper","left_collateral","not_in_office","closed_locked"] as const) {
      expect(isEngagedDisposition(d)).toBe(true);
    }
    for (const d of ["do_not_contact","out_of_business"] as const) {
      expect(isEngagedDisposition(d)).toBe(false);
    }
  });
});
