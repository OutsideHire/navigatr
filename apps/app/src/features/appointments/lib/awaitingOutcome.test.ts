import { describe, it, expect } from "vitest";
import { computeAwaitingOutcome, type AppointmentForOutcomeCheck } from "./awaitingOutcome";

const now = new Date("2026-07-27T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(now.getTime() + ms).toISOString();

function appt(overrides: Partial<AppointmentForOutcomeCheck>): AppointmentForOutcomeCheck {
  return {
    id: "a1",
    deal_id: "d1",
    title: "Site visit",
    start_at: ago(2 * HOUR),
    end_at: ago(1 * HOUR),
    status: "scheduled",
    outcome: null,
    ...overrides,
  };
}

describe("computeAwaitingOutcome", () => {
  it("includes a past-due scheduled appointment with no outcome", () => {
    const a = appt({});
    expect(computeAwaitingOutcome([a], now)).toEqual([a]);
  });

  it("excludes an appointment whose end_at is still in the future", () => {
    const a = appt({ end_at: ahead(1 * HOUR) });
    expect(computeAwaitingOutcome([a], now)).toEqual([]);
  });

  it("excludes a cancelled appointment", () => {
    const a = appt({ status: "cancelled" });
    expect(computeAwaitingOutcome([a], now)).toEqual([]);
  });

  it("excludes a completed appointment", () => {
    const a = appt({ status: "completed" });
    expect(computeAwaitingOutcome([a], now)).toEqual([]);
  });

  it("excludes an appointment that already has an outcome recorded", () => {
    const a = appt({ outcome: "appt_verbal_commitment" });
    expect(computeAwaitingOutcome([a], now)).toEqual([]);
  });

  it("sorts results by end_at ascending", () => {
    const older = appt({ id: "a-older", end_at: ago(5 * HOUR) });
    const newer = appt({ id: "a-newer", end_at: ago(1 * HOUR) });
    expect(computeAwaitingOutcome([newer, older], now)).toEqual([older, newer]);
  });

  it("treats an appointment ending exactly now as not yet past-due", () => {
    const a = appt({ end_at: now.toISOString() });
    expect(computeAwaitingOutcome([a], now)).toEqual([]);
  });

  it("returns empty for no appointments", () => {
    expect(computeAwaitingOutcome([], now)).toEqual([]);
  });
});
