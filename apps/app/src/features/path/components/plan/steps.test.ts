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
  it("ships the SP3 six-step order: mode → search → results → review → schedule → saved", () => {
    expect(PLAN_STEPS.map((s) => s.key)).toEqual([
      "mode",
      "search",
      "results",
      "review",
      "schedule",
      "saved",
    ]);
  });

  it("every step has a non-empty title", () => {
    for (const s of PLAN_STEPS) expect(s.title.length).toBeGreaterThan(0);
  });

  it("stepIndex returns the zero-based position, -1 for unknown", () => {
    expect(stepIndex("mode")).toBe(0);
    expect(stepIndex("schedule")).toBe(4);
    expect(stepIndex("saved")).toBe(5);
    expect(stepIndex("nope" as StepKey)).toBe(-1);
  });

  it("stepFor returns the descriptor and throws on unknown", () => {
    expect(stepFor("search").title).toBe("Search & filters");
    expect(() => stepFor("nope" as StepKey)).toThrow();
  });

  it('derives "Step N of M" (1-based N, M = total)', () => {
    expect(stepLabel("mode")).toBe("Step 1 of 6");
    expect(stepLabel("results")).toBe("Step 3 of 6");
    expect(stepLabel("saved")).toBe("Step 6 of 6");
  });

  it("nextStep / prevStep walk the list and clamp at the ends", () => {
    expect(nextStep("mode")).toBe("search");
    expect(nextStep("review")).toBe("schedule");
    expect(nextStep("schedule")).toBe("saved");
    expect(nextStep("saved")).toBeNull();

    expect(prevStep("saved")).toBe("schedule");
    expect(prevStep("schedule")).toBe("review");
    expect(prevStep("search")).toBe("mode");
    expect(prevStep("mode")).toBeNull();
  });
});
