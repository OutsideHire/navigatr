import { describe, it, expect } from "vitest";
import { resolveDrop } from "./resolveDrop";

describe("resolveDrop", () => {
  it("returns the target stage on a cross-column drop", () => {
    expect(resolveDrop("new", "qualified")).toBe("qualified");
  });
  it("returns null for a same-column drop", () => {
    expect(resolveDrop("new", "new")).toBeNull();
  });
  it("returns null when there is no drop target", () => {
    expect(resolveDrop("new", null)).toBeNull();
    expect(resolveDrop("new", undefined)).toBeNull();
  });
});
