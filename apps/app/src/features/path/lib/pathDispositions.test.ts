import { describe, it, expect } from "vitest";
import { PATH_DISPOSITION_KEYS, isEngagedDisposition } from "./pathDispositions";
import { DISPOSITIONS_BY_TYPE } from "@/features/activities/lib/dispositionSets";

describe("path dispositions", () => {
  it("lists the field drop-in outcomes in the desired order", () => {
    expect(PATH_DISPOSITION_KEYS).toEqual([
      "statement_secured", "met_dm", "scheduled_callback",
      "gatekeeper", "left_collateral", "not_in_office",
      "closed_locked", "do_not_contact", "out_of_business",
    ]);
  });

  it("is the SAME list the stop logger uses (single source, can't drift)", () => {
    // The nearby-card DropInSheet reads PATH_DISPOSITION_KEYS; the Path stop
    // logger + Activities logger (LogActivitySheet) read
    // DISPOSITIONS_BY_TYPE.drop_in. They MUST be one and the same array, or the
    // two drop-in screens can diverge again (the 2026-09 regression). Reference
    // equality proves it's literally one source, not two copies kept in sync.
    expect(PATH_DISPOSITION_KEYS).toBe(DISPOSITIONS_BY_TYPE.drop_in.all);
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
