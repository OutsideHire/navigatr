import { describe, it, expect } from "vitest";
import { isClassDEligible, bandPosition, urgencyFor, type ClassDTaskLike } from "./classD";

const task = (o: Partial<ClassDTaskLike> = {}): ClassDTaskLike => ({
  type: "drop_in",
  status: "open",
  earliestAt: "2026-08-05",
  targetAt: "2026-08-07",
  latestAt: "2026-08-12",
  dateSource: "interval",
  excludeFromPath: false,
  ...o,
});

describe("isClassDEligible", () => {
  const base = { type: "drop_in", status: "open", earliestAt: "2026-08-05", excludeFromPath: false, dealStage: "contacted", hasCoords: true };
  it("accepts an open, routable drop-in on an open deal once its window opens", () => {
    expect(isClassDEligible(base, "2026-08-06")).toBe(true);
  });
  it("rejects before the window opens", () => {
    expect(isClassDEligible(base, "2026-08-04")).toBe(false);
  });
  it("rejects without coordinates, when opted out, when not a drop-in, or on a closed deal", () => {
    expect(isClassDEligible({ ...base, hasCoords: false }, "2026-08-06")).toBe(false);
    expect(isClassDEligible({ ...base, excludeFromPath: true }, "2026-08-06")).toBe(false);
    expect(isClassDEligible({ ...base, type: "call" }, "2026-08-06")).toBe(false);
    expect(isClassDEligible({ ...base, dealStage: "won" }, "2026-08-06")).toBe(false);
    expect(isClassDEligible({ ...base, dealStage: "lost" }, "2026-08-06")).toBe(false);
  });
});

describe("bandPosition", () => {
  it("classifies by the band dates", () => {
    expect(bandPosition(task(), "2026-08-04")).toBe("not_yet_open");
    expect(bandPosition(task(), "2026-08-06")).toBe("in_window");
    expect(bandPosition(task(), "2026-08-09")).toBe("past_ideal");
    expect(bandPosition(task(), "2026-08-20")).toBe("aging");
  });
  it("an asserted/sla date is always pinned", () => {
    expect(bandPosition(task({ dateSource: "asserted" }), "2026-08-04")).toBe("pinned");
    expect(bandPosition(task({ dateSource: "sla" }), "2026-08-20")).toBe("pinned");
  });
});

describe("urgencyFor", () => {
  it("is flat 3 for aging and pinned", () => {
    expect(urgencyFor(task(), "2026-08-20")).toBe(3);
    expect(urgencyFor(task({ dateSource: "asserted" }), "2026-08-04")).toBe(3);
  });
  it("interpolates 0->1 in-window and 1->2 past-ideal", () => {
    expect(urgencyFor(task(), "2026-08-05")).toBe(0); // earliest
    expect(urgencyFor(task(), "2026-08-07")).toBe(1); // target
    // past-ideal midpoint target(08-07)..latest(08-12): 08-09 ~ 1 + 2/5
    expect(urgencyFor(task(), "2026-08-09")).toBeCloseTo(1.4, 5);
    expect(urgencyFor(task(), "2026-08-12")).toBe(2); // latest
  });
  it("is 0 before the window opens", () => {
    expect(urgencyFor(task(), "2026-08-04")).toBe(0);
  });
});
