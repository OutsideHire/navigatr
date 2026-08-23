import { describe, it, expect } from "vitest";
import { resolveScopeLevel, scopePhrase, scopeTagLabel } from "./scope";

describe("resolveScopeLevel", () => {
  it("org for administrator and cso_cro regardless of reports", () => {
    expect(resolveScopeLevel("administrator", false)).toBe("org");
    expect(resolveScopeLevel("cso_cro", false)).toBe("org");
    expect(resolveScopeLevel("administrator", true)).toBe("org");
  });
  it("team for a non-org role that has reports", () => {
    expect(resolveScopeLevel("vp_sales", true)).toBe("team");
    expect(resolveScopeLevel("sales_manager", true)).toBe("team");
  });
  it("you for an individual contributor with no reports", () => {
    expect(resolveScopeLevel("sales_professional", false)).toBe("you");
    expect(resolveScopeLevel("sales_manager", false)).toBe("you");
    expect(resolveScopeLevel(null, false)).toBe("you");
  });
});

describe("scopePhrase", () => {
  it("gives the module + level phrasing", () => {
    expect(scopePhrase("pipeline", "you")).toBe("Your pipeline");
    expect(scopePhrase("pipeline", "team")).toBe("Your team's pipeline");
    expect(scopePhrase("pipeline", "org")).toBe("Your organization's pipeline");
    expect(scopePhrase("partners", "team")).toBe("Your team's partners");
  });
  it("a filtered name wins over the default phrase", () => {
    expect(scopePhrase("pipeline", "team", "Dana Lopez")).toBe("Dana Lopez");
    expect(scopePhrase("pipeline", "team", "  ")).toBe("Your team's pipeline");
  });
});

describe("scopeTagLabel", () => {
  it("maps levels to You / Team / Org", () => {
    expect(scopeTagLabel("you")).toBe("You");
    expect(scopeTagLabel("team")).toBe("Team");
    expect(scopeTagLabel("org")).toBe("Org");
  });
  it("uses the seller's first name when filtered", () => {
    expect(scopeTagLabel("team", "Dana Lopez")).toBe("Dana");
    expect(scopeTagLabel("org", "Priya")).toBe("Priya");
  });
});
