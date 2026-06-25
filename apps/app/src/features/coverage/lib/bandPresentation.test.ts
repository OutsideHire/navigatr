import { describe, it, expect } from "vitest";
import { bandPresentation, confidenceLabel } from "./bandPresentation";

describe("bandPresentation", () => {
  it("maps green bands to success, amber to warning, red to danger", () => {
    expect(bandPresentation("excellent").tokenClass).toContain("success");
    expect(bandPresentation("good").tokenClass).toContain("success");
    expect(bandPresentation("adequate").tokenClass).toContain("warning");
    expect(bandPresentation("poor").tokenClass).toContain("warning");
    expect(bandPresentation("unreliable").tokenClass).toContain("danger");
  });
  it("gives a human label per band", () => {
    expect(bandPresentation("excellent").label).toBe("Excellent");
    expect(bandPresentation("unreliable").label).toBe("Unreliable");
  });
  it("returns a pill class for each band", () => {
    expect(bandPresentation("good").pillClass).toBeTruthy();
  });
});

describe("confidenceLabel", () => {
  it("qualifies low/medium and omits for high", () => {
    expect(confidenceLabel("low")).toBe("Estimated · low confidence");
    expect(confidenceLabel("medium")).toBe("Estimated");
    expect(confidenceLabel("high")).toBeNull();
  });
  it("qualifies insufficient defensively (not normally rendered)", () => {
    expect(confidenceLabel("insufficient")).toBe("Estimated · low confidence");
  });
});
