import { describe, it, expect } from "vitest";
import { portalAddress } from "./portalAddress";

describe("portalAddress", () => {
  it("builds the shareable portal address from an origin and slug", () => {
    expect(portalAddress("acme", "https://app.getnavigatr.io/")).toBe("https://app.getnavigatr.io/p/acme");
  });

  it("defaults to the current origin", () => {
    expect(portalAddress("acme")).toBe(`${window.location.origin}/p/acme`);
  });
});
