import { describe, it, expect } from "vitest";
import { PATH_DISPOSITION_KEYS, isEngagedDisposition } from "./pathDispositions";
import { DISPOSITIONS } from "@/lib/followUpScheduling";

describe("pathDispositions", () => {
  it("lists the 10 field drop-in tiles, each a real disposition", () => {
    expect(PATH_DISPOSITION_KEYS).toHaveLength(10);
    for (const k of PATH_DISPOSITION_KEYS) {
      expect(DISPOSITIONS[k]).toBeDefined();
    }
  });

  it("marks exactly the four engaged outcomes as deal-creating", () => {
    const engaged = PATH_DISPOSITION_KEYS.filter(isEngagedDisposition);
    expect(new Set(engaged)).toEqual(
      new Set(["met_dm", "gatekeeper", "left_collateral", "scheduled_callback"]),
    );
  });

  it("non-engaged outcomes are not deal-creating", () => {
    expect(isEngagedDisposition("not_in_office")).toBe(false);
    expect(isEngagedDisposition("out_of_business")).toBe(false);
    expect(isEngagedDisposition("not_interested")).toBe(false);
  });
});
