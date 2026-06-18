import { describe, it, expect } from "vitest";
import { readMerchantQualification } from "./merchantQualification";

describe("readMerchantQualification", () => {
  it("parses a merchant_services profession_data blob", () => {
    const q = readMerchantQualification({
      profession: "merchant_services", annualVolume: 500000, acceptanceMethods: ["card_present", "ecommerce"],
      currentProcessor: "Square", currentEffectiveRate: 2.6, posTerminal: "Clover", avgTicketSize: 45,
    });
    expect(q).not.toBeNull();
    expect(q!.annualVolume).toBe(500000);
    expect(q!.acceptanceMethods).toEqual(["card_present", "ecommerce"]);
    expect(q!.currentProcessor).toBe("Square");
    expect(q!.currentEffectiveRate).toBe(2.6);
  });
  it("returns null for non-merchant or missing profession", () => {
    expect(readMerchantQualification({ profession: "payroll" })).toBeNull();
    expect(readMerchantQualification(null)).toBeNull();
    expect(readMerchantQualification(undefined)).toBeNull();
  });
  it("tolerates partial/garbage fields", () => {
    const q = readMerchantQualification({ profession: "merchant_services", annualVolume: "oops", acceptanceMethods: "nope" });
    expect(q).not.toBeNull();
    expect(q!.annualVolume).toBeUndefined();
    expect(q!.acceptanceMethods).toEqual([]);
  });
});
