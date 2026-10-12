import { describe, it, expect } from "vitest";
import { portalAddress, referralFormAddress } from "./portalAddress";

describe("portalAddress", () => {
  it("builds the shareable portal address from an origin and slug", () => {
    expect(portalAddress("acme", "https://app.getnavigatr.io/")).toBe("https://app.getnavigatr.io/p/acme");
  });

  it("defaults to the current origin", () => {
    expect(portalAddress("acme")).toBe(`${window.location.origin}/p/acme`);
  });
});

describe("referralFormAddress", () => {
  it("builds the public form address for a link", () => {
    expect(referralFormAddress("acme", "aB3_-xYz", "https://app.getnavigatr.io/")).toBe(
      "https://app.getnavigatr.io/p/acme/refer/aB3_-xYz",
    );
  });

  it("defaults to the current origin and encodes the parts", () => {
    expect(referralFormAddress("acme co", "t/1")).toBe(`${window.location.origin}/p/acme%20co/refer/t%2F1`);
  });
});
