import { describe, it, expect } from "vitest";
import { planInterstitial, type PlaceDuplicateMatch } from "./placeInterstitial";

const match = (over: Partial<PlaceDuplicateMatch>): PlaceDuplicateMatch => ({
  tier: "place_id",
  dealId: "d1",
  companyName: "Pat's Diner",
  dealHasPlaceId: true,
  ...over,
});

describe("planInterstitial", () => {
  it("returns mode none for no match", () => {
    const plan = planInterstitial(null, true);
    expect(plan.mode).toBe("none");
    expect(plan.canAttach).toBe(false);
    expect(plan.dealId).toBeNull();
  });

  it("blocks on a place_id match, no attach when the existing deal already has a place_id", () => {
    const plan = planInterstitial(match({ tier: "place_id", dealHasPlaceId: true }), true);
    expect(plan.mode).toBe("block");
    expect(plan.canAttach).toBe(false);
    expect(plan.title).toContain("already in your pipeline");
  });

  it("offers attach on a blocking match when the existing deal has no place_id and the candidate does", () => {
    const plan = planInterstitial(match({ tier: "name_address", dealHasPlaceId: false }), true);
    expect(plan.mode).toBe("block");
    expect(plan.canAttach).toBe(true);
    expect(plan.body.toLowerCase()).toContain("attach");
  });

  it("does not offer attach when the candidate has no place_id (manual entry)", () => {
    const plan = planInterstitial(match({ tier: "name_address", dealHasPlaceId: false }), false);
    expect(plan.mode).toBe("block");
    expect(plan.canAttach).toBe(false);
  });

  it("soft-confirms a phone match", () => {
    const plan = planInterstitial(match({ tier: "phone" }), true);
    expect(plan.mode).toBe("confirm");
    expect(plan.canAttach).toBe(false);
    expect(plan.body.toLowerCase()).toContain("phone");
  });

  it("soft-confirms a name match", () => {
    const plan = planInterstitial(match({ tier: "name" }), true);
    expect(plan.mode).toBe("confirm");
    expect(plan.body.toLowerCase()).toContain("business name");
  });

  it("offers second-location linking on a base_name match", () => {
    const plan = planInterstitial(match({ tier: "base_name" }), true);
    expect(plan.mode).toBe("second_location");
    expect(plan.canAttach).toBe(false);
    expect(plan.title.toLowerCase()).toContain("second location");
  });
});
