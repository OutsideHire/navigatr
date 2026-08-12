import { describe, it, expect } from "vitest";
import { reasonLine, stopLabel, lastVisitContext, type ReasonStop } from "./reasonLine";

const base: ReasonStop = {
  kind: "flexible", tier: "nearby", startAt: null, ageDays: null,
  datePromisedToday: false, hasPriorActivity: false,
};

describe("stopLabel (v2.2 B 4.5)", () => {
  it("appointment tier is labeled 'appointment'", () => {
    expect(stopLabel({ ...base, kind: "appointment", tier: "appointment", startAt: "2026-08-10T15:00:00Z" }))
      .toBe("appointment");
  });
  it("an asserted promise is labeled 'you promised'", () => {
    expect(stopLabel({ ...base, tier: "due_today", datePromisedToday: true, hasPriorActivity: true }))
      .toBe("you promised");
  });
  it("a discovery fill (nearby, no prior activity) is labeled 'on the way'", () => {
    expect(stopLabel({ ...base, tier: "nearby", hasPriorActivity: false }))
      .toBe("on the way");
  });
  it("an owed / due-today drop-in in its band is labeled 'anytime'", () => {
    expect(stopLabel({ ...base, tier: "past_due", ageDays: 9, hasPriorActivity: true }))
      .toBe("anytime");
    expect(stopLabel({ ...base, tier: "due_today", ageDays: 0, hasPriorActivity: true }))
      .toBe("anytime");
  });
  it("appointment wins over an asserted promise", () => {
    expect(stopLabel({ ...base, kind: "appointment", tier: "appointment", startAt: "x", datePromisedToday: true }))
      .toBe("appointment");
  });
  it("nearby WITH prior activity falls to 'anytime', not 'on the way'", () => {
    expect(stopLabel({ ...base, tier: "nearby", hasPriorActivity: true, ageDays: 4 }))
      .toBe("anytime");
  });
});

describe("reasonLine (v2.2 B 4.5.1 detail-only sentences)", () => {
  it("appointment names the contact when there is one", () => {
    expect(reasonLine({ ...base, kind: "appointment", tier: "appointment", startAt: "2026-08-10T15:00:00Z", contactName: "Jane Roe" }))
      .toBe("Jane Roe");
  });
  it("appointment with no contact renders an empty sentence", () => {
    expect(reasonLine({ ...base, kind: "appointment", tier: "appointment", startAt: "2026-08-10T15:00:00Z" }))
      .toBe("");
    expect(reasonLine({ ...base, kind: "appointment", tier: "appointment", startAt: "2026-08-10T15:00:00Z", contactName: null }))
      .toBe("");
  });
  it("an asserted promise reads 'The owner is expecting you.'", () => {
    expect(reasonLine({ ...base, tier: "due_today", datePromisedToday: true, hasPriorActivity: true }))
      .toBe("The owner is expecting you.");
  });
  it("an owed drop-in states days since the last stop", () => {
    expect(reasonLine({ ...base, tier: "past_due", ageDays: 9, hasPriorActivity: true }))
      .toBe("9 days since your last stop.");
  });
  it("owed drop-in singular day", () => {
    expect(reasonLine({ ...base, tier: "past_due", ageDays: 1, hasPriorActivity: true }))
      .toBe("1 day since your last stop.");
  });
  it("a discovery fill (nearby, no prior activity) reads 'Nobody's been in yet.'", () => {
    expect(reasonLine({ ...base, tier: "nearby", hasPriorActivity: false }))
      .toBe("Nobody's been in yet.");
  });
  it("due_today without a promise falls back to the days line by age", () => {
    expect(reasonLine({ ...base, tier: "due_today", datePromisedToday: false, ageDays: 0, hasPriorActivity: true }))
      .toBe("0 days since your last stop.");
  });
  it("nearby WITH prior activity uses the days line, not the 'Nobody' line", () => {
    expect(reasonLine({ ...base, tier: "nearby", hasPriorActivity: true, ageDays: 4 }))
      .toBe("4 days since your last stop.");
  });
  it("null ageDays coalesces to 0 at the fallback", () => {
    expect(reasonLine({ ...base, tier: "past_due", ageDays: null, hasPriorActivity: true }))
      .toBe("0 days since your last stop.");
  });
  it("appointment wins over a promise (still empty/contact, not the promise line)", () => {
    expect(reasonLine({ ...base, kind: "appointment", tier: "appointment", startAt: "x", datePromisedToday: true }))
      .toBe("");
  });
});

describe("lastVisitContext", () => {
  it("restates an outcome plainly", () => {
    expect(lastVisitContext("Owner not in")).toBe("Last time, owner not in.");
  });
  it("returns null when there is no prior outcome", () => {
    expect(lastVisitContext(null)).toBeNull();
  });
});
