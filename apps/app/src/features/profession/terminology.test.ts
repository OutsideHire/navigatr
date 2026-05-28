/**
 * terminology.test.ts — resolveTerm fallback chain.
 *
 * The 3-step chain (override → profession default → fallback) is the
 * load-bearing piece of the whole profession system. Every consumer
 * surface depends on the right cell being picked.
 */
import { describe, it, expect } from "vitest";
import {
  resolveTerm,
  TERMINOLOGY_DEFAULTS,
  TERM_FALLBACKS,
  type Profession,
} from "./terminology";

describe("resolveTerm", () => {
  it("uses per-org override when present (highest priority)", () => {
    const out = resolveTerm("deal", "merchant_services", { deal: "case" });
    expect(out).toBe("case");
  });

  it("uses profession default when no override", () => {
    expect(resolveTerm("company", "merchant_services", null)).toBe("merchant");
    expect(resolveTerm("company", "treasury_management", null)).toBe("client");
    expect(resolveTerm("company", "payroll", null)).toBe("company");
  });

  it("uses TERM_FALLBACKS when no profession is set", () => {
    expect(resolveTerm("deal", null, null)).toBe(TERM_FALLBACKS.deal);
    expect(resolveTerm("value", null, null)).toBe(TERM_FALLBACKS.value);
  });

  it("uses TERM_FALLBACKS when override is empty string", () => {
    expect(resolveTerm("deal", "merchant_services", { deal: "" })).toBe("deal");
  });

  it("uses TERM_FALLBACKS when override key is missing", () => {
    expect(resolveTerm("deal", "merchant_services", { value: "MRR" })).toBe("deal");
  });

  it("treasury_management has its expected vocabulary", () => {
    // Spot-check the three most-visible terms.
    expect(resolveTerm("deal", "treasury_management", null)).toBe("relationship");
    expect(resolveTerm("value", "treasury_management", null)).toBe("AUM");
    expect(resolveTerm("pipeline", "treasury_management", null)).toBe("book");
  });

  it("every profession defines every TermKey (no accidental gaps)", () => {
    const professions: Profession[] = ["payroll", "merchant_services", "treasury_management"];
    const keys = Object.keys(TERM_FALLBACKS) as Array<keyof typeof TERM_FALLBACKS>;
    for (const p of professions) {
      for (const k of keys) {
        expect(TERMINOLOGY_DEFAULTS[p][k], `${p}.${k} is missing`).toBeDefined();
      }
    }
  });
});
