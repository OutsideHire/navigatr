import { describe, it, expect } from "vitest";
import {
  normalizeDealName,
  phoneTail10,
  baseDealName,
  normalizeAddress,
  isBlockingTier,
  classifyDuplicateTier,
  type ExistingDealForDedupe,
} from "./placeDedupe";

describe("normalizeDealName", () => {
  it("lowercases, strips punctuation, drops legal suffix + article", () => {
    expect(normalizeDealName("The Pat's Diner, LLC")).toBe("pat s diner");
  });
  it("expands & to and", () => {
    expect(normalizeDealName("Smith & Sons Inc")).toBe("smith and sons");
  });
  it("returns empty string for blank/nullish", () => {
    expect(normalizeDealName("")).toBe("");
    expect(normalizeDealName(null)).toBe("");
    expect(normalizeDealName("  LLC  ")).toBe("");
  });
});

describe("phoneTail10", () => {
  it("returns the last 10 digits, stripping formatting", () => {
    expect(phoneTail10("(512) 555-0101")).toBe("5125550101");
  });
  it("strips a leading country 1", () => {
    expect(phoneTail10("+1 512-555-0101")).toBe("5125550101");
    expect(phoneTail10("15125550101")).toBe("5125550101");
  });
  it("returns null when fewer than 10 digits", () => {
    expect(phoneTail10("555-0101")).toBeNull();
    expect(phoneTail10(null)).toBeNull();
    expect(phoneTail10("")).toBeNull();
  });
});

describe("baseDealName", () => {
  it("strips a trailing compass direction", () => {
    expect(baseDealName("Lone Star HVAC - North")).toBe("lone star hvac");
  });
  it("strips a trailing store number", () => {
    expect(baseDealName("Subway #4471")).toBe("subway");
  });
  it("strips a trailing 'location N'", () => {
    expect(baseDealName("Star Grill Location 12")).toBe("star grill");
  });
  it("keeps a leading directional (only strips from the end)", () => {
    expect(baseDealName("North Star Grill")).toBe("north star grill");
  });
  it("never strips down to empty (keeps at least one token)", () => {
    expect(baseDealName("North")).toBe("north");
  });
});

describe("normalizeAddress", () => {
  it("expands street types and drops unit designators keeping the number", () => {
    expect(normalizeAddress("101 Congress Avenue, Suite 200")).toBe("101 congress ave 200");
  });
  it("returns empty for blank", () => {
    expect(normalizeAddress(null)).toBe("");
  });
});

describe("isBlockingTier", () => {
  it("blocks on place_id and name_address, soft otherwise", () => {
    expect(isBlockingTier("place_id")).toBe(true);
    expect(isBlockingTier("name_address")).toBe(true);
    expect(isBlockingTier("phone")).toBe(false);
    expect(isBlockingTier("name")).toBe(false);
    expect(isBlockingTier("base_name")).toBe(false);
  });
});

describe("classifyDuplicateTier", () => {
  const deal = (over: Partial<ExistingDealForDedupe>): ExistingDealForDedupe => ({
    id: "d1",
    companyName: "Pat's Family Diner",
    address: "101 Congress Ave, Austin, TX",
    contactPhone: "+15125550101",
    placeId: "place_pats",
    ...over,
  });

  it("returns null when nothing matches", () => {
    const cand = { placeId: "place_new", name: "Brand New Co", address: "9 Nowhere Rd", phone: "5120009999" };
    expect(classifyDuplicateTier(cand, [deal({})])).toBeNull();
  });

  it("matches place_id as the strongest (blocking) tier", () => {
    const cand = { placeId: "place_pats", name: "Totally Different", address: "elsewhere", phone: null };
    const m = classifyDuplicateTier(cand, [deal({})]);
    expect(m?.tier).toBe("place_id");
    expect(isBlockingTier(m!.tier)).toBe(true);
  });

  it("matches name_address (blocking) when no place_id but same name+address", () => {
    // Same address string (differing only by legal suffix + 'Avenue' vs 'Ave'),
    // so both normalize to the same name+address key.
    const cand = { placeId: null, name: "Pat's Family Diner LLC", address: "101 Congress Avenue, Austin, TX", phone: null };
    const m = classifyDuplicateTier(cand, [deal({ placeId: null })]);
    expect(m?.tier).toBe("name_address");
  });

  it("matches phone (soft) when place/name+address differ but phone shares tail-10", () => {
    const cand = { placeId: null, name: "Pats Diner Downtown", address: "500 Other St", phone: "(512) 555-0101" };
    const m = classifyDuplicateTier(cand, [deal({ placeId: null, companyName: "Pat's Family Diner" })]);
    expect(m?.tier).toBe("phone");
  });

  it("matches name (soft) when only the normalized name is equal", () => {
    const cand = { placeId: null, name: "Pat's Family Diner", address: "999 Far Away Blvd", phone: "5129990000" };
    const m = classifyDuplicateTier(cand, [deal({ placeId: null, contactPhone: "5120000000" })]);
    expect(m?.tier).toBe("name");
  });

  it("matches base_name (soft, second location) when base names align but full names differ", () => {
    const cand = { placeId: null, name: "Lone Star HVAC - North", address: "1400 Research Blvd", phone: "5120001111" };
    const existing = deal({
      placeId: null,
      companyName: "Lone Star HVAC - South",
      address: "900 Industrial Blvd",
      contactPhone: "5122223333",
    });
    const m = classifyDuplicateTier(cand, [existing]);
    expect(m?.tier).toBe("base_name");
    expect(isBlockingTier(m!.tier)).toBe(false);
  });

  it("prefers the stronger tier when multiple deals match at different tiers", () => {
    const cand = { placeId: "place_pats", name: "Pat's Family Diner", address: "101 Congress Ave", phone: "5125550101" };
    const softer = deal({ id: "d_soft", placeId: null, companyName: "Pat's Family Diner", address: "zzz" });
    const stronger = deal({ id: "d_strong", placeId: "place_pats" });
    const m = classifyDuplicateTier(cand, [softer, stronger]);
    expect(m?.tier).toBe("place_id");
    expect(m?.deal.id).toBe("d_strong");
  });
});
