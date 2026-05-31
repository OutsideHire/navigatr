// Tests for the ICP classification core (FR-PATH-11→15). One assertion per
// rule + both branches of every gate, in the order classifyProspect applies
// them, because order matters: the category gate must win over the seed list,
// the institutional gate over density, etc.

import { describe, it, expect } from "vitest";
import {
  normalizeCategory,
  isConsumerOnly,
  isInstitutional,
  matchesSeed,
  classifyProspect,
  DEFAULT_ICP_CONFIG,
  type IcpConfig,
} from "./icpFilter";

const SEED = [
  { pattern: "subway", brand: "Subway" },
  { pattern: "jersey mike", brand: "Jersey Mike's" },
  { pattern: "chase", brand: "Chase Bank" },
];

describe("normalizeCategory", () => {
  it("strips generic Places noise types and keeps the first meaningful one", () => {
    expect(normalizeCategory(["point_of_interest", "establishment", "restaurant"])).toBe("restaurant");
  });
  it("lowercases and trims", () => {
    expect(normalizeCategory([" Cafe ", "establishment"])).toBe("cafe");
  });
  it("falls back to 'other' when only generic types are present", () => {
    expect(normalizeCategory(["point_of_interest", "establishment"])).toBe("other");
  });
  it("falls back to 'other' on an empty list", () => {
    expect(normalizeCategory([])).toBe("other");
  });
});

describe("isConsumerOnly", () => {
  it("false for a hotel (lodging is now a valid prospect)", () => {
    // Hotels process card volume + run payroll → in profile (PATH_DESIGN §6.1).
    expect(isConsumerOnly(["lodging", "establishment"])).toBe(false);
  });
  it("true for a large venue (arena)", () => {
    expect(isConsumerOnly(["arena", "establishment"])).toBe(true);
  });
  it("true for a parking garage", () => {
    expect(isConsumerOnly(["parking_garage"])).toBe(true);
  });
  it("true for a municipal swimming pool (city-run rec, e.g. Barton Springs)", () => {
    expect(isConsumerOnly(["swimming_pool"])).toBe(true);
  });
  it("true for a place of worship", () => {
    expect(isConsumerOnly(["church", "place_of_worship"])).toBe(true);
  });
  it("true for a school", () => {
    expect(isConsumerOnly(["primary_school"])).toBe(true);
  });
  it("false for a normal B2B office", () => {
    expect(isConsumerOnly(["accounting", "establishment"])).toBe(false);
  });
});

describe("isInstitutional", () => {
  it("true for a hospital", () => {
    expect(isInstitutional(["hospital"])).toBe(true);
  });
  it("true for a government office", () => {
    expect(isInstitutional(["local_government_office", "city_hall"])).toBe(true);
  });
  it("true for a public library", () => {
    expect(isInstitutional(["library"])).toBe(true);
  });
  it("false for a retail store", () => {
    expect(isInstitutional(["store", "establishment"])).toBe(false);
  });
});

describe("matchesSeed", () => {
  it("matches a known chain by case-insensitive substring", () => {
    expect(matchesSeed("Subway #4471", SEED)).toBe("Subway");
  });
  it("matches a disguised-ish franchise name containing the pattern", () => {
    expect(matchesSeed("JERSEY MIKE'S SUBS", SEED)).toBe("Jersey Mike's");
  });
  it("returns null for an independent business", () => {
    expect(matchesSeed("Pat's Family Diner", SEED)).toBeNull();
  });
  it("returns null on an empty name", () => {
    expect(matchesSeed("", SEED)).toBeNull();
  });
  it("ignores empty patterns defensively", () => {
    expect(matchesSeed("anything", [{ pattern: "", brand: "X" }])).toBeNull();
  });
});

describe("classifyProspect — gate ordering and outcomes", () => {
  const candidate = (over: Partial<{ name: string; types: string[]; employeeCount: number | null }> = {}) => ({
    placeId: "p1",
    name: over.name ?? "Pat's Family Diner",
    types: over.types ?? ["restaurant", "establishment"],
    employeeCount: over.employeeCount ?? null,
  });

  it("a clean independent SMB is servable (in profile, not chain)", () => {
    const v = classifyProspect(candidate(), SEED, 0);
    expect(v).toEqual({ category: "restaurant", inProfile: true, isChain: false, chainReason: null });
  });

  it("category gate wins first: a consumer-only place is out of profile even if it also looks like a seed match", () => {
    // name contains 'subway' (seed) AND type is church (consumer-only). The
    // category gate runs before the seed check, so it's simply out of profile.
    const v = classifyProspect(candidate({ name: "Subway Community Church", types: ["church", "place_of_worship"] }), SEED, 0);
    expect(v.inProfile).toBe(false);
    expect(v.isChain).toBe(false);
    expect(v.chainReason).toBeNull();
  });

  it("a hotel is servable (lodging is in profile after the §6.1 decision)", () => {
    const v = classifyProspect(candidate({ name: "Downtown Boutique Hotel", types: ["lodging"] }), SEED, 0);
    expect(v).toEqual({ category: "lodging", inProfile: true, isChain: false, chainReason: null });
  });

  it("institutional gate flags gov before seed/density", () => {
    const v = classifyProspect(candidate({ name: "City Hospital", types: ["hospital"] }), SEED, 50);
    expect(v).toEqual({ category: "hospital", inProfile: true, isChain: true, chainReason: "gov" });
  });

  it("seed-list chain is flagged with reason seed_list", () => {
    const v = classifyProspect(candidate({ name: "Subway #200", types: ["restaurant"] }), SEED, 0);
    expect(v.isChain).toBe(true);
    expect(v.chainReason).toBe("seed_list");
  });

  it("unknown chain trips the same-name-density heuristic", () => {
    // Not in SEED, but 11 same-name locations already cached nearby (>10).
    const v = classifyProspect(candidate({ name: "Taco Cabana Regional", types: ["restaurant"] }), SEED, 11);
    expect(v.isChain).toBe(true);
    expect(v.chainReason).toBe("same_name_density");
  });

  it("exactly at the threshold is NOT a chain (strictly greater-than)", () => {
    const v = classifyProspect(candidate({ name: "Edge Co", types: ["store"] }), SEED, DEFAULT_ICP_CONFIG.sameNameChainThreshold);
    expect(v.isChain).toBe(false);
  });

  it("employee_count rule is OFF by default even with a huge count (vendor-gated)", () => {
    const v = classifyProspect(candidate({ name: "BigCo", types: ["office"], employeeCount: 5000 }), SEED, 0);
    expect(v.isChain).toBe(false);
    expect(v.chainReason).toBeNull();
  });

  it("employee_count rule fires when a cutoff is configured AND a count is present", () => {
    const config: IcpConfig = { ...DEFAULT_ICP_CONFIG, maxEmployeeCount: 250 };
    const v = classifyProspect(candidate({ name: "BigCo", types: ["office"], employeeCount: 300 }), SEED, 0, config);
    expect(v.isChain).toBe(true);
    expect(v.chainReason).toBe("employee_count");
  });

  it("employee_count rule does not fire below the configured cutoff", () => {
    const config: IcpConfig = { ...DEFAULT_ICP_CONFIG, maxEmployeeCount: 250 };
    const v = classifyProspect(candidate({ name: "SmallCo", types: ["office"], employeeCount: 40 }), SEED, 0, config);
    expect(v.isChain).toBe(false);
  });
});
