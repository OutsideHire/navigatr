import { describe, expect, it } from "vitest";
import { insertStop, type InsertStopOptions } from "./insertStop";
import type { FlexibleStop, OrderedStop } from "./todaysPath";

const ORIGIN = { lat: 0, lng: 0 };

/** A flexible stop at an explicit coordinate. */
function flex(
  id: string,
  lat: number,
  lng: number,
  tier: FlexibleStop["tier"] = "nearby",
): FlexibleStop {
  return { id, dealId: null, name: `flex-${id}`, lat, lng, tier, ageDays: null };
}

/** A flexible stop already placed in the ordered run. */
function orderedFlex(id: string, lat: number, lng: number): OrderedStop {
  return {
    id,
    kind: "flexible",
    tier: "nearby",
    name: `flex-${id}`,
    dealId: null,
    lat,
    lng,
    startAt: null,
    endAt: null,
    ageDays: null,
  };
}

/** A fixed appointment anchor. */
function appt(
  id: string,
  lat: number,
  lng: number,
  startAt: string,
  endAt: string | null = null,
): OrderedStop {
  return {
    id,
    kind: "appointment",
    tier: "appointment",
    name: `appt-${id}`,
    dealId: null,
    lat,
    lng,
    startAt,
    endAt,
    ageDays: null,
  };
}

const ids = (list: OrderedStop[]): string[] => list.map((s) => s.id);

describe("insertStop", () => {
  it("inserts into a gap, keeping the original stops in their relative order", () => {
    const ordered = [orderedFlex("a", 0, 0.01), orderedFlex("b", 0, 0.02)];
    const candidate = flex("c", 0, 0.005);
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T09:00:00Z", // 8h of slack, everything fits
    };

    const result = insertStop(ordered, candidate, opts);

    expect(result).not.toBeNull();
    expect(ids(result!)).toContain("c");
    // Original stops keep their relative order (a before b).
    const nonCandidate = ids(result!).filter((id) => id !== "c");
    expect(nonCandidate).toEqual(["a", "b"]);
  });

  it("returns null when the day is full (no index keeps within the window)", () => {
    // 35-minute window: with the per-kind flexible dwell of 15, three flexible
    // stops need at least 45 min of dwell alone, so a third stop cannot fit at
    // any position.
    const ordered = [orderedFlex("a", 0, 0.01), orderedFlex("b", 0, 0.02)];
    const candidate = flex("c", 0, 0.03);
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T16:25:00Z", // only 35 minutes to 17:00
    };

    expect(insertStop(ordered, candidate, opts)).toBeNull();
  });

  it("a flexible candidate holds 15 minutes, not the old flat 20 (per-kind dwell)", () => {
    // Empty run, candidate at the origin (zero drive). Only 16 minutes remain to
    // 17:00: 15 <= 16 fits, so the day holds it. Under the old flat 20-min dwell
    // this would not have fit and insertStop would return null.
    const ordered: OrderedStop[] = [];
    const candidate = flex("c", 0, 0);
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T16:44:00Z", // 16 minutes to 17:00
    };

    const result = insertStop(ordered, candidate, opts);
    expect(result).not.toBeNull();
    expect(ids(result!)).toEqual(["c"]);
  });

  it("holds an end-less appointment for the 30-min appointment dwell (per-kind)", () => {
    // A pre-placed appointment with no endAt at 16:30, and a flexible candidate,
    // starting 16:00 with the window closing at 17:00. The appointment is held
    // for its 30-min dwell (through 17:00), leaving no room for the flexible to
    // follow it, so the candidate must be placed before the appointment.
    const a = appt("a", 0, 0, "2026-08-10T16:30:00Z", null);
    const candidate = flex("c", 0, 0);
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T16:00:00Z",
    };

    const result = insertStop([a], candidate, opts);
    expect(result).not.toBeNull();
    expect(ids(result!)).toEqual(["c", "a"]);
  });

  it("never reorders the placed stops", () => {
    const ordered = [
      orderedFlex("a", 0, 0.03),
      orderedFlex("b", 0, 0.01),
      orderedFlex("c", 0, 0.02),
    ];
    const candidate = flex("x", 0, 0.015);
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T09:00:00Z",
    };

    const result = insertStop(ordered, candidate, opts);

    expect(result).not.toBeNull();
    const nonCandidate = ids(result!).filter((id) => id !== "x");
    expect(nonCandidate).toEqual(["a", "b", "c"]);
  });

  it("never makes an appointment late (places the candidate after it)", () => {
    // Appointment is nearly immediate; inserting the candidate BEFORE it would
    // blow past its startAt, so it must land after the appointment.
    const ordered = [appt("m", 0, 0.01, "2026-08-10T09:02:00Z")];
    const candidate = flex("c", 0, 0.05); // far: would delay the appointment
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T09:00:00Z",
    };

    const result = insertStop(ordered, candidate, opts);

    expect(result).not.toBeNull();
    expect(ids(result!)).toEqual(["m", "c"]);
  });

  it("does not wedge a stop between two close appointments (models appointment occupancy, so a later appointment is never made late)", () => {
    // Two appointments back-to-back: A holds 09:30-10:30, B starts 10:40.
    // A and B sit next to the origin; the candidate is far. Inserting the
    // candidate BEFORE A makes A late, and inserting it BETWEEN A and B would
    // only look feasible under a naive flat-dwell model that ignores A's real
    // occupancy through 10:30. Once A is modeled as held until its endAt, the
    // only place the candidate can go is AFTER B.
    const a = appt("a", 0, 0.007, "2026-08-10T09:30:00Z", "2026-08-10T10:30:00Z");
    const b = appt("b", 0, 0.007, "2026-08-10T10:40:00Z");
    const ordered = [a, b];
    const candidate = flex("c", 0, 0.2); // far: ~27 min each way from origin
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T09:00:00Z",
    };

    const result = insertStop(ordered, candidate, opts);

    expect(result).not.toBeNull();
    // The candidate must land after B (never between A and B).
    expect(ids(result!)).toEqual(["a", "b", "c"]);
    const idxC = ids(result!).indexOf("c");
    const idxB = ids(result!).indexOf("b");
    expect(idxC).toBeGreaterThan(idxB);
  });

  it("returns null when the candidate has no coordinates", () => {
    const ordered = [orderedFlex("a", 0, 0.01)];
    const candidate = {
      id: "c",
      dealId: null,
      name: "no-coords",
      lat: null,
      lng: null,
      tier: "nearby",
      ageDays: null,
    } as unknown as FlexibleStop;
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T09:00:00Z",
    };

    expect(insertStop(ordered, candidate, opts)).toBeNull();
  });
});
