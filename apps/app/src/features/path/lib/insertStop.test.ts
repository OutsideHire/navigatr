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
    endAt: null,
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
    // 60-minute window: two placed stops already consume most of it, and a
    // third stop (drive + dwell) cannot fit at any position.
    const ordered = [orderedFlex("a", 0, 0.01), orderedFlex("b", 0, 0.02)];
    const candidate = flex("c", 0, 0.03);
    const opts: InsertStopOptions = {
      origin: ORIGIN,
      windowEndHour: 17,
      now: "2026-08-10T16:00:00Z", // only 60 minutes to 17:00
    };

    expect(insertStop(ordered, candidate, opts)).toBeNull();
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
