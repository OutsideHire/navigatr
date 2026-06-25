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
  it("gives a human label per band (all five pinned)", () => {
    expect(
      (["excellent", "good", "adequate", "poor", "unreliable"] as const).map((b) => bandPresentation(b).label),
    ).toEqual(["Excellent", "Good", "Adequate", "Poor", "Unreliable"]);
  });
  it("returns a pill class for each band", () => {
    expect(bandPresentation("good").pillClass).toBeTruthy();
  });
  it("returns a static solid bar class per band tier", () => {
    expect(bandPresentation("good").barClass).toBe("bg-status-success");
    expect(bandPresentation("poor").barClass).toBe("bg-status-warning");
    expect(bandPresentation("unreliable").barClass).toBe("bg-status-danger");
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
