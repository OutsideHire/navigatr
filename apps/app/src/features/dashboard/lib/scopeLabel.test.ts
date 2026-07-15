import { describe, it, expect } from "vitest";
import { scopeLabel } from "./scopeLabel";

describe("scopeLabel", () => {
  it("labels each role's dashboard scope", () => {
    expect(scopeLabel("admin")).toBe("Your organization");
    expect(scopeLabel("manager")).toBe("Your team");
    expect(scopeLabel("rep")).toBe("Your activity");
  });
  it("returns null when the role is unknown / not loaded", () => {
    expect(scopeLabel(undefined)).toBeNull();
  });
});
