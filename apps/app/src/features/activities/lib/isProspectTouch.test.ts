import { describe, it, expect } from "vitest";
import { isProspectTouch } from "./isProspectTouch";

describe("isProspectTouch", () => {
  it("is true for the four merchant-contact types", () => {
    for (const t of ["call", "email", "drop_in", "appointment"] as const) {
      expect(isProspectTouch(t)).toBe(true);
    }
  });

  it("is false for todo (internal work, never a touch)", () => {
    expect(isProspectTouch("todo")).toBe(false);
  });
});
