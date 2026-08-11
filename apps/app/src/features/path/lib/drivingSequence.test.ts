import { describe, it, expect } from "vitest";
import {
  drivingSequence,
  type DrivingSequenceInput,
} from "./drivingSequence";
import { driveMinutesBetween } from "./driveTime";

const NOW = "2026-08-10T14:00:00Z";
const APPT_START = "2026-08-10T15:00:00Z";

/** Same formatter the impl uses, so the assertion is tz-independent. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function baseInput(): DrivingSequenceInput {
  return {
    meetings: [
      {
        id: "m1",
        kind: "appointment",
        title: "Acme Corp",
        address: "1 Main St",
        dealId: "deal-appt",
        appointmentId: "appt-1",
        startAt: APPT_START,
        lat: 40.0,
        lng: -74.0,
      },
    ],
    pastDue: [
      {
        taskId: "owed-1",
        dealId: "deal-owed",
        name: "Bob's Diner",
        address: "2 Oak Ave",
        ageDays: 9,
        lat: 40.01,
        lng: -74.01,
      },
    ],
    dueToday: [
      {
        taskId: "due-1",
        dealId: "deal-due",
        name: "Carla's Cafe",
        address: "3 Elm St",
        lat: 40.02,
        lng: -74.02,
      },
    ],
    native: [
      {
        merchantId: "merch-1",
        name: "New Place",
        address: "4 Pine St",
        lat: 40.03,
        lng: -74.03,
      },
    ],
    origin: { lat: 39.99, lng: -73.99 },
  };
}

describe("drivingSequence", () => {
  it("interleaves flexible drop-ins around the appointment anchor by time (kinds + ids)", () => {
    // now 2pm, appointment 3pm: a full hour of gap. With the per-kind flexible
    // dwell of 15 min (down from the old flat 20), all three flexible drop-ins
    // now fit before the 3pm anchor, so the anchor lands last. Order is
    // time-aware, not meetings-first.
    const cards = drivingSequence(baseInput(), NOW);
    expect(cards.map((c) => c.kind)).toEqual([
      "owed",
      "owed",
      "nearby",
      "appointment",
    ]);
    expect(cards.map((c) => c.id)).toEqual(["owed-1", "due-1", "merch-1", "m1"]);
    // Past-due vs due-today share the "owed" kind; their reason line differs.
    expect(cards[0]!.reason).toBe("You have not stopped by in 9 days.");
    expect(cards[1]!.reason).toBe("You have not stopped by in 0 days.");
  });

  it("places a flexible drop-in BEFORE an appointment when it fits in the gap", () => {
    const input: DrivingSequenceInput = {
      meetings: [
        {
          id: "m1",
          kind: "appointment",
          title: "Acme Corp",
          startAt: APPT_START,
          endAt: null,
          lat: 40.0,
          lng: -74.0,
        },
      ],
      pastDue: [
        {
          taskId: "owed-1",
          dealId: "deal-owed",
          name: "Bob's Diner",
          ageDays: 4,
          lat: 40.01,
          lng: -74.01,
        },
      ],
      dueToday: [],
      native: [],
      origin: { lat: 39.99, lng: -73.99 },
    };
    // now 2pm, appointment 3pm: the owed stop plus the drive on to the
    // appointment fits inside the hour, so it is dropped in first.
    const cards = drivingSequence(input, NOW);
    expect(cards.map((c) => c.kind)).toEqual(["owed", "appointment"]);
    expect(cards.map((c) => c.id)).toEqual(["owed-1", "m1"]);
    // The appointment still reads its exact clock time; the flexible reads "around".
    expect(cards[1]!.arriveLabel).toBe(clock(APPT_START));
    expect(cards[0]!.arriveLabel.startsWith("around ")).toBe(true);
  });

  it("keeps a flexible drop-in AFTER an appointment when it does not fit before it", () => {
    const input: DrivingSequenceInput = {
      meetings: [
        {
          id: "m1",
          kind: "appointment",
          title: "Acme Corp",
          startAt: APPT_START,
          endAt: null,
          lat: 40.0,
          lng: -74.0,
        },
      ],
      pastDue: [
        {
          taskId: "owed-1",
          dealId: "deal-owed",
          name: "Bob's Diner",
          ageDays: 4,
          lat: 40.01,
          lng: -74.01,
        },
      ],
      dueToday: [],
      native: [],
      origin: { lat: 39.99, lng: -73.99 },
    };
    // Start only four minutes before the 3pm appointment: the owed stop plus
    // its dwell can no longer fit before it, so it falls after the anchor.
    const cards = drivingSequence(input, "2026-08-10T14:56:00Z");
    expect(cards.map((c) => c.kind)).toEqual(["appointment", "owed"]);
    expect(cards.map((c) => c.id)).toEqual(["m1", "owed-1"]);
  });

  it("sorts two meetings by startAt ascending", () => {
    const input = baseInput();
    input.meetings = [
      {
        id: "late",
        kind: "appointment",
        title: "Later",
        startAt: "2026-08-10T16:00:00Z",
        lat: 40.0,
        lng: -74.0,
      },
      {
        id: "early",
        kind: "external",
        title: "Earlier",
        startAt: "2026-08-10T15:00:00Z",
        lat: 40.0,
        lng: -74.0,
      },
    ];
    input.pastDue = [];
    input.dueToday = [];
    input.native = [];
    const cards = drivingSequence(input, NOW);
    expect(cards.map((c) => c.id)).toEqual(["early", "late"]);
    expect(cards.map((c) => c.kind)).toEqual(["external", "appointment"]);
  });

  it("builds reason strings per kind", () => {
    const cards = drivingSequence(baseInput(), NOW);
    const appt = cards.find((c) => c.kind === "appointment")!;
    const owed = cards.find((c) => c.id === "owed-1")!;
    const native = cards.find((c) => c.kind === "nearby")!;
    expect(appt.reason).toMatch(/^You have a .+ here\.$/);
    expect(owed.reason).toBe("You have not stopped by in 9 days.");
    expect(native.reason).toBe("New. You have not been in.");
  });

  it("uses the exact clock time for appointment arriveLabel and 'around' for flexible", () => {
    const cards = drivingSequence(baseInput(), NOW);
    const appt = cards.find((c) => c.kind === "appointment")!;
    expect(appt.arriveLabel).toBe(clock(APPT_START));
    const flexible = cards.find((c) => c.kind === "owed")!;
    expect(flexible.arriveLabel.startsWith("around ")).toBe(true);
  });

  it("emits a driveMinLabel matching /^\\d+ min$/ on every card", () => {
    const cards = drivingSequence(baseInput(), NOW);
    for (const c of cards) {
      expect(c.driveMinLabel).toMatch(/^\d+ min$/);
    }
  });

  it("fills lastVisit from lastOutcomeByDealId when present, else null", () => {
    const withMap = drivingSequence(
      { ...baseInput(), lastOutcomeByDealId: { "deal-owed": "Owner not in" } },
      NOW,
    );
    const owed = withMap.find((c) => c.kind === "owed")!;
    expect(owed.lastVisit).toBe("Last time, owner not in.");

    const withoutMap = drivingSequence(baseInput(), NOW);
    expect(withoutMap.find((c) => c.kind === "owed")!.lastVisit).toBeNull();
  });

  it("threads drive + dwell into a numeric 'around {clock}' for a flexible card after a meeting", () => {
    // One meeting with coords, then one owed card that does NOT fit before the
    // appointment (tight window), so the owed card follows the meeting. Its
    // arrival = now + drive(origin->meeting) + dwell + drive(meeting->owed),
    // formatted the same way the impl formats it.
    const origin = { lat: 39.99, lng: -73.99 };
    const meetingPoint = { lat: 40.0, lng: -74.0 };
    const owedPoint = { lat: 40.01, lng: -74.01 };
    const dwellMin = 20;
    // Start four minutes before the 3pm appointment: no gap for the owed stop.
    const tightNow = "2026-08-10T14:56:00Z";

    const input: DrivingSequenceInput = {
      meetings: [
        {
          id: "m1",
          kind: "appointment",
          title: "Acme",
          startAt: APPT_START,
          lat: meetingPoint.lat,
          lng: meetingPoint.lng,
        },
      ],
      pastDue: [
        {
          taskId: "owed-1",
          dealId: "deal-owed",
          name: "Bob's Diner",
          ageDays: 3,
          lat: owedPoint.lat,
          lng: owedPoint.lng,
        },
      ],
      dueToday: [],
      native: [],
      origin,
      dwellMin,
    };

    const leg1 = driveMinutesBetween(origin, meetingPoint);
    const leg2 = driveMinutesBetween(meetingPoint, owedPoint);
    const arriveMs =
      new Date(tightNow).getTime() + (leg1 + dwellMin + leg2) * 60_000;
    const expected = `around ${new Date(arriveMs).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;

    const cards = drivingSequence(input, tightNow);
    expect(cards.map((c) => c.kind)).toEqual(["appointment", "owed"]);
    const owed = cards.find((c) => c.kind === "owed")!;
    expect(owed.arriveLabel).toBe(expected);
  });

  it("holds a meeting for the 30-min appointment dwell before a trailing flexible card (per-kind, no override)", () => {
    // Same shape as the override test above, but WITHOUT dwellMin, so dwell is
    // derived per kind. The owed card cannot fit before the 3pm appointment
    // (tight start), so it follows the meeting. Its arrival threads the 30-min
    // appointment dwell (not 15): now + drive(origin->meeting) + 30 +
    // drive(meeting->owed).
    const origin = { lat: 39.99, lng: -73.99 };
    const meetingPoint = { lat: 40.0, lng: -74.0 };
    const owedPoint = { lat: 40.01, lng: -74.01 };
    const tightNow = "2026-08-10T14:56:00Z";

    const input: DrivingSequenceInput = {
      meetings: [
        {
          id: "m1",
          kind: "appointment",
          title: "Acme",
          startAt: APPT_START,
          lat: meetingPoint.lat,
          lng: meetingPoint.lng,
        },
      ],
      pastDue: [
        {
          taskId: "owed-1",
          dealId: "deal-owed",
          name: "Bob's Diner",
          ageDays: 3,
          lat: owedPoint.lat,
          lng: owedPoint.lng,
        },
      ],
      dueToday: [],
      native: [],
      origin,
    };

    const leg1 = driveMinutesBetween(origin, meetingPoint);
    const leg2 = driveMinutesBetween(meetingPoint, owedPoint);
    const arriveMs =
      new Date(tightNow).getTime() + (leg1 + 30 + leg2) * 60_000; // 30 = appt dwell
    const expected = `around ${new Date(arriveMs).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;

    const cards = drivingSequence(input, tightNow);
    expect(cards.map((c) => c.kind)).toEqual(["appointment", "owed"]);
    expect(cards.find((c) => c.kind === "owed")!.arriveLabel).toBe(expected);
  });

  it("floors a sub-minute-but-nonzero leg to '1 min'", () => {
    // Two points a few meters apart: driveMinutes > 0 but rounds to 0.
    const origin = { lat: 40.0, lng: -74.0 };
    const nearby = { lat: 40.00002, lng: -74.00002 };
    const input: DrivingSequenceInput = {
      meetings: [],
      pastDue: [],
      dueToday: [],
      native: [
        {
          merchantId: "merch-close",
          name: "Right Next Door",
          lat: nearby.lat,
          lng: nearby.lng,
        },
      ],
      origin,
    };
    const leg = driveMinutesBetween(origin, nearby);
    expect(leg).toBeGreaterThan(0);
    expect(Math.round(leg)).toBe(0);

    const cards = drivingSequence(input, NOW);
    expect(cards[0]!.driveMinLabel).toBe("1 min");
  });

  it("does not throw and yields '0 min' for a meeting with null coords", () => {
    const input = baseInput();
    input.meetings = [
      {
        id: "no-coords",
        kind: "appointment",
        title: "Phantom",
        startAt: APPT_START,
        lat: null,
        lng: null,
      },
    ];
    input.pastDue = [];
    input.dueToday = [];
    input.native = [];
    const cards = drivingSequence(input, NOW);
    expect(cards[0]!.driveMinLabel).toBe("0 min");
  });
});
