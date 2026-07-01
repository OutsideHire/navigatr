import { describe, it, expect } from "vitest";
import {
  PLAN_STEPS,
  stepIndex,
  stepFor,
  stepLabel,
  nextStep,
  prevStep,
  type StepKey,
} from "./steps";

describe("plan wizard steps descriptor", () => {
  it("ships the SP2 five-step order: mode → search → results → review → saved", () => {
    expect(PLAN_STEPS.map((s) => s.key)).toEqual([
      "mode",
      "search",
      "results",
      "review",
      "saved",
    ]);
  });

  it("every step has a non-empty title", () => {
    for (const s of PLAN_STEPS) expect(s.title.length).toBeGreaterThan(0);
  });

  it("stepIndex returns the zero-based position, -1 for unknown", () => {
    expect(stepIndex("mode")).toBe(0);
    expect(stepIndex("saved")).toBe(4);
    expect(stepIndex("nope" as StepKey)).toBe(-1);
  });

  it("stepFor returns the descriptor and throws on unknown", () => {
    expect(stepFor("search").title).toBe("Search & filters");
    expect(() => stepFor("nope" as StepKey)).toThrow();
  });

  it('derives "Step N of M" (1-based N, M = total)', () => {
    expect(stepLabel("mode")).toBe("Step 1 of 5");
    expect(stepLabel("results")).toBe("Step 3 of 5");
    expect(stepLabel("saved")).toBe("Step 5 of 5");
  });

  it("nextStep / prevStep walk the list and clamp at the ends", () => {
    expect(nextStep("mode")).toBe("search");
    expect(nextStep("review")).toBe("saved");
    expect(nextStep("saved")).toBeNull();

    expect(prevStep("saved")).toBe("review");
    expect(prevStep("search")).toBe("mode");
    expect(prevStep("mode")).toBeNull();
  });
});
