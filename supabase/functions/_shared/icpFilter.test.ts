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
  matchesEnterprise,
  classifyProspect,
  DEFAULT_ICP_CONFIG,
  type IcpConfig,
} from "./icpFilter";

const SEED = [
  { pattern: "subway", brandId: "subway", brand: "Subway" },
  { pattern: "jersey mike", brandId: "jersey_mikes", brand: "Jersey Mike's" },
  { pattern: "chase", brandId: "chase", brand: "Chase Bank" },
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
    expect(matchesSeed("Subway #4471", SEED)).toEqual({ brandId: "subway", brand: "Subway" });
  });
  it("matches a disguised-ish franchise name containing the pattern", () => {
    expect(matchesSeed("JERSEY MIKE'S SUBS", SEED)).toEqual({ brandId: "jersey_mikes", brand: "Jersey Mike's" });
  });
  it("returns null for an independent business", () => {
    expect(matchesSeed("Pat's Family Diner", SEED)).toBeNull();
  });
  it("returns null on an empty name", () => {
    expect(matchesSeed("", SEED)).toBeNull();
  });
  it("ignores empty patterns defensively", () => {
    expect(matchesSeed("anything", [{ pattern: "", brandId: "x", brand: "X" }])).toBeNull();
  });
});

describe("matchesEnterprise", () => {
  it("matches a Big-4 office by case-insensitive substring", () => {
    expect(matchesEnterprise("Deloitte & Touche LLP")).toBe("deloitte");
  });
  it("matches a listing portal (national tech, not a local brokerage)", () => {
    expect(matchesEnterprise("Realtor.com Austin Office")).toBe("realtor.com");
  });
  it("does NOT match a locally-owned franchise office (real ICP)", () => {
    // RE/MAX and Keller Williams offices run their own books — deliberately NOT
    // in enterpriseBrands, so they survive as servable prospects.
    expect(matchesEnterprise("Keller Williams Realty - Downtown")).toBeNull();
    expect(matchesEnterprise("RE/MAX Capital City")).toBeNull();
  });
  it("returns null for an independent professional-services SMB", () => {
    expect(matchesEnterprise("Hill Country Bookkeeping & Tax")).toBeNull();
  });
  it("returns null on an empty name", () => {
    expect(matchesEnterprise("")).toBeNull();
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
    expect(v).toEqual({ category: "restaurant", inProfile: true, isChain: false, chainReason: null, chainConfidence: null, chainBrandId: null, chainBrandName: null });
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
    expect(v).toEqual({ category: "lodging", inProfile: true, isChain: false, chainReason: null, chainConfidence: null, chainBrandId: null, chainBrandName: null });
  });

  it("institutional gate flags gov before seed/density", () => {
    const v = classifyProspect(candidate({ name: "City Hospital", types: ["hospital"] }), SEED, 50);
    expect(v).toEqual({ category: "hospital", inProfile: true, isChain: true, chainReason: "gov", chainConfidence: null, chainBrandId: null, chainBrandName: null });
  });

  it("seed-list chain is flagged with reason seed_list", () => {
    const v = classifyProspect(candidate({ name: "Subway #200", types: ["restaurant"] }), SEED, 0);
    expect(v.isChain).toBe(true);
    expect(v.chainReason).toBe("seed_list");
  });

  it("a national enterprise is flagged with reason enterprise", () => {
    // The Deloitte case from the smoke test: tagged accounting/consultant (in
    // profile, passes every other gate) but floated up by POPULARITY. Name match
    // pulls it out so reps see independent SMBs, not Big-4 offices.
    const v = classifyProspect(candidate({ name: "Deloitte Austin", types: ["accounting", "consultant"] }), SEED, 0);
    expect(v.isChain).toBe(true);
    expect(v.chainReason).toBe("enterprise");
  });

  it("a locally-owned franchise office survives (not flagged enterprise)", () => {
    // Keller Williams office: real-estate franchise, runs its own books = ICP.
    const v = classifyProspect(candidate({ name: "Keller Williams Realty Lake Travis", types: ["real_estate_agency"] }), SEED, 0);
    expect(v).toEqual({ category: "real_estate_agency", inProfile: true, isChain: false, chainReason: null, chainConfidence: null, chainBrandId: null, chainBrandName: null });
  });

  it("seed list wins over the enterprise gate when a name matches both", () => {
    // Order check: seed runs before enterprise. Contrive a name in both lists.
    const config: IcpConfig = { ...DEFAULT_ICP_CONFIG, enterpriseBrands: [...DEFAULT_ICP_CONFIG.enterpriseBrands, "subway"] };
    const v = classifyProspect(candidate({ name: "Subway #5", types: ["restaurant"] }), SEED, 0, config);
    expect(v.chainReason).toBe("seed_list");
  });

  it("enterprise gate wins over same-name density", () => {
    // Deloitte with 50 same-name nearby still reports 'enterprise', not density,
    // because the enterprise check runs first.
    const v = classifyProspect(candidate({ name: "Deloitte", types: ["accounting"] }), SEED, 50);
    expect(v.chainReason).toBe("enterprise");
  });

  it("unknown chain trips the same-name-density heuristic", () => {
    // Not in SEED, but 25 same-name locations already cached nearby (>=25).
    const v = classifyProspect(candidate({ name: "Taco Cabana Regional", types: ["restaurant"] }), SEED, 25);
    expect(v.isChain).toBe(true);
    expect(v.chainReason).toBe("same_name_density");
  });

  it("just below the threshold on a non-chain-prone type is NOT a chain", () => {
    // 24 same-name (< 25) and types ["store"] is not chain-prone → no tiebreak.
    const v = classifyProspect(candidate({ name: "Edge Co", types: ["store"] }), SEED, DEFAULT_ICP_CONFIG.sameNameChainThreshold - 1);
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

describe("Slice 5 chain confidence + brand", () => {
  const seed = [{ pattern: "subway", brandId: "subway", brand: "Subway" }];

  it("allowlist match → high confidence + brand attribution", () => {
    const v = classifyProspect({ placeId: "x", name: "Subway #4471", types: ["sandwich_shop"] }, seed, 0);
    expect(v.isChain).toBe(true);
    expect(v.chainConfidence).toBe("high");
    expect(v.chainBrandId).toBe("subway");
    expect(v.chainBrandName).toBe("Subway");
  });

  it("name-frequency >= 25 → medium chain", () => {
    const v = classifyProspect({ placeId: "x", name: "Joe Coffee", types: ["coffee_shop"] }, [], 25);
    expect(v.isChain).toBe(true);
    expect(v.chainConfidence).toBe("medium");
    expect(v.chainBrandId).toBeNull();
  });

  it("name-frequency 24 (below 25) on a NON-chain-prone type → not a chain", () => {
    const v = classifyProspect({ placeId: "x", name: "Joe Coffee", types: ["coffee_shop"] }, [], 24);
    expect(v.isChain).toBe(false);
    expect(v.chainConfidence).toBeNull();
  });

  it("place-type tiebreak: chain-prone primary type + borderline density [12,25) → medium", () => {
    const v = classifyProspect(
      { placeId: "x", name: "QuickGas", types: ["gas_station"], primaryType: "gas_station" },
      [], 15,
    );
    expect(v.isChain).toBe(true);
    expect(v.chainConfidence).toBe("medium");
  });

  it("place-type alone (low density) never sets is_chain", () => {
    const v = classifyProspect(
      { placeId: "x", name: "QuickGas", types: ["gas_station"], primaryType: "gas_station" },
      [], 3,
    );
    expect(v.isChain).toBe(false);
  });

  it("clean SMB → no chain fields", () => {
    const v = classifyProspect({ placeId: "x", name: "Pat's Diner", types: ["diner"] }, [], 0);
    expect(v.isChain).toBe(false);
    expect(v.chainConfidence).toBeNull();
    expect(v.chainBrandId).toBeNull();
    expect(v.chainBrandName).toBeNull();
  });

  it("matchesSeed returns brandId + brand", () => {
    expect(matchesSeed("Subway #1", seed)).toEqual({ brandId: "subway", brand: "Subway" });
    expect(matchesSeed("Pat's Diner", seed)).toBeNull();
  });

  it("default same-name threshold is 25", () => {
    expect(DEFAULT_ICP_CONFIG.sameNameChainThreshold).toBe(25);
  });
});
