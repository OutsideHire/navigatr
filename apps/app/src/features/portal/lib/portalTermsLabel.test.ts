import { describe, it, expect } from "vitest";
import { portalTermsAgreeLabel } from "./portalTermsLabel";

describe("portalTermsAgreeLabel", () => {
  it("names both sets of terms when the ISO has its own", () => {
    expect(portalTermsAgreeLabel("Acme ISO", "Be fair.")).toBe(
      "I agree to the Navigatr Referral Portal Terms and the partner terms from Acme ISO",
    );
  });

  it("never builds a possessive from the ISO name", () => {
    expect(portalTermsAgreeLabel("Acme Payments", "Be fair.")).toBe(
      "I agree to the Navigatr Referral Portal Terms and the partner terms from Acme Payments",
    );
    expect(portalTermsAgreeLabel("Acme Payments", "Be fair.")).not.toContain("'s");
  });

  it("names only navigatr's terms when the ISO has none", () => {
    expect(portalTermsAgreeLabel("Acme ISO", "")).toBe("I agree to the Navigatr Referral Portal Terms");
    expect(portalTermsAgreeLabel("Acme ISO", "  \n ")).toBe("I agree to the Navigatr Referral Portal Terms");
  });
});
