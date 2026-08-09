import { describe, it, expect } from "vitest";
import { reasonLine, lastVisitContext, type ReasonStop } from "./reasonLine";

const base: ReasonStop = {
  kind: "flexible", tier: "nearby", startAt: null, ageDays: null,
  datePromisedToday: false, hasPriorActivity: false,
};

describe("reasonLine", () => {
  it("appointment reads the booked time", () => {
    expect(reasonLine({ ...base, kind: "appointment", tier: "appointment", startAt: "2026-08-10T15:00:00Z" }))
      .toMatch(/^You have a .+ here\.$/);
  });
  it("promised visit due today", () => {
    expect(reasonLine({ ...base, tier: "due_today", datePromisedToday: true }))
      .toBe("You told the owner you would come back today.");
  });
  it("owed drop-in states days since last touch", () => {
    expect(reasonLine({ ...base, tier: "past_due", ageDays: 9 }))
      .toBe("You have not stopped by in 9 days.");
  });
  it("owed drop-in singular day", () => {
    expect(reasonLine({ ...base, tier: "past_due", ageDays: 1 }))
      .toBe("You have not stopped by in 1 day.");
  });
  it("discovered stop with no prior activity", () => {
    expect(reasonLine({ ...base, tier: "nearby", hasPriorActivity: false }))
      .toBe("New. Nobody has been in.");
  });
  it("due_today without a promise falls back to a plain owed line by age", () => {
    expect(reasonLine({ ...base, tier: "due_today", datePromisedToday: false, ageDays: 0 }))
      .toBe("You have not stopped by in 0 days.");
  });
  it("appointment tier with no startAt falls through to the days line", () => {
    expect(reasonLine({ ...base, kind: "appointment", tier: "appointment", startAt: null, ageDays: 0 }))
      .toBe("You have not stopped by in 0 days.");
  });
  it("nearby WITH prior activity does not use the New line", () => {
    expect(reasonLine({ ...base, tier: "nearby", hasPriorActivity: true, ageDays: 4 }))
      .toBe("You have not stopped by in 4 days.");
  });
  it("null ageDays coalesces to 0 at the fallback", () => {
    expect(reasonLine({ ...base, tier: "past_due", ageDays: null }))
      .toBe("You have not stopped by in 0 days.");
  });
  it("appointment wins over a promise when both apply", () => {
    expect(reasonLine({ ...base, kind: "appointment", tier: "appointment", startAt: "2026-08-10T15:00:00Z", datePromisedToday: true }))
      .toMatch(/^You have a .+ here\.$/);
  });
  it("lastVisitContext restates an outcome plainly", () => {
    expect(lastVisitContext("Owner not in")).toBe("Last time, owner not in.");
  });
  it("lastVisitContext returns null when there is no prior outcome", () => {
    expect(lastVisitContext(null)).toBeNull();
  });
});
