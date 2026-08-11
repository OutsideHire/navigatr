import { describe, it, expect } from "vitest";

import { buildDayStopPins } from "./dayStopPins";
import type { OrderedStop } from "./todaysPath";

/** Minimal OrderedStop factory — only the fields the pin builder reads matter. */
function stop(partial: Partial<OrderedStop> & Pick<OrderedStop, "id">): OrderedStop {
  return {
    id: partial.id,
    kind: partial.kind ?? "flexible",
    tier: partial.tier ?? "nearby",
    name: partial.name ?? partial.id,
    dealId: partial.dealId ?? null,
    // `in` (not `??`) so an explicit null coordinate is preserved.
    lat: "lat" in partial ? (partial.lat ?? null) : 30.26,
    lng: "lng" in partial ? (partial.lng ?? null) : -97.74,
    startAt: partial.startAt ?? null,
    endAt: partial.endAt ?? null,
    ageDays: partial.ageDays ?? null,
  };
}

describe("buildDayStopPins", () => {
  it("numbers pins 1..N in the given route order", () => {
    const pins = buildDayStopPins([
      stop({ id: "a", lat: 1, lng: 1 }),
      stop({ id: "b", lat: 2, lng: 2 }),
      stop({ id: "c", lat: 3, lng: 3 }),
    ]);
    expect(pins.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(pins.map((p) => p.index)).toEqual([1, 2, 3]);
    // Coordinates are carried straight through.
    expect(pins[0]).toMatchObject({ lat: 1, lng: 1 });
    expect(pins[2]).toMatchObject({ lat: 3, lng: 3 });
  });

  it("maps past_due -> warm and everything else -> neutral", () => {
    const pins = buildDayStopPins([
      stop({ id: "appt", kind: "appointment", tier: "appointment" }),
      stop({ id: "external", kind: "external", tier: "appointment" }),
      stop({ id: "overdue", tier: "past_due", ageDays: 12 }),
      stop({ id: "today", tier: "due_today" }),
      stop({ id: "near", tier: "nearby" }),
    ]);
    const state = Object.fromEntries(pins.map((p) => [p.id, p.agingState]));
    expect(state).toEqual({
      appt: "neutral",
      external: "neutral",
      overdue: "warm",
      today: "neutral",
      near: "neutral",
    });
    // No stop is "hot" yet (Ticket B 4.6 rewires the true band).
    expect(pins.every((p) => p.agingState !== "hot")).toBe(true);
  });

  it("flags isAppointment only for the appointment tier, independent of color", () => {
    const pins = buildDayStopPins([
      stop({ id: "appt", kind: "appointment", tier: "appointment" }),
      stop({ id: "overdue", tier: "past_due", ageDays: 3 }),
      stop({ id: "near", tier: "nearby" }),
    ]);
    const flag = Object.fromEntries(pins.map((p) => [p.id, p.isAppointment]));
    expect(flag).toEqual({ appt: true, overdue: false, near: false });
    // The appointment carries a color state too — but it is aging-driven
    // (neutral), never "because it is an appointment".
    expect(pins.find((p) => p.id === "appt")!.agingState).toBe("neutral");
  });

  it("excludes null-coord stops and keeps the numbering contiguous", () => {
    const pins = buildDayStopPins([
      stop({ id: "a", lat: 1, lng: 1 }),
      stop({ id: "no-lat", lat: null, lng: 2 }),
      stop({ id: "no-lng", lat: 3, lng: null }),
      stop({ id: "both-null", lat: null, lng: null }),
      stop({ id: "b", lat: 4, lng: 4 }),
    ]);
    expect(pins.map((p) => p.id)).toEqual(["a", "b"]);
    expect(pins.map((p) => p.index)).toEqual([1, 2]);
  });

  it("excludes non-finite coordinates (NaN)", () => {
    const pins = buildDayStopPins([
      stop({ id: "nan", lat: Number.NaN, lng: 1 }),
      stop({ id: "ok", lat: 2, lng: 2 }),
    ]);
    expect(pins.map((p) => p.id)).toEqual(["ok"]);
    expect(pins[0].index).toBe(1);
  });

  it("returns an empty list for no stops", () => {
    expect(buildDayStopPins([])).toEqual([]);
  });
});
