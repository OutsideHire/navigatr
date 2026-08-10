import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MeetingStop } from "../lib/meetingStops";
import type { OwedVisit } from "../lib/owedVisits";
import type { TodayStop } from "./useTodayPath";

// The four LIVE data sources, mocked with mutable state (default: empty, not loading).
const meetingState = { current: { stops: [] as MeetingStop[], isLoading: false } };
const owedState = { current: { owed: [] as OwedVisit[], isLoading: false } };
const dueTodayState = { current: { dueToday: [] as OwedVisit[], isLoading: false } };
const todayPathState = { current: { stops: [] as TodayStop[], isLoading: false } };

vi.mock("./useMeetingStops", () => ({ useMeetingStops: () => meetingState.current }));
vi.mock("./useOwedVisits", () => ({ useOwedVisits: () => owedState.current }));
vi.mock("./useDueTodayVisits", () => ({ useDueTodayVisits: () => dueTodayState.current }));
vi.mock("./useTodayPath", () => ({ useTodayPath: () => todayPathState.current }));

import { useDrivingSequence } from "./useDrivingSequence";

const PATH_DATE = "2026-08-08";
const ORIGIN = { lat: 30.25, lng: -97.75 };
const NOW = "2026-08-08T09:00:00Z";

function owedVisit(over: Partial<OwedVisit> = {}): OwedVisit {
  return {
    taskId: "t1",
    dealId: "deal-owed-1",
    name: "Owed Co",
    address: "500 Owed St",
    placeId: "place-1",
    lat: 30.2,
    lng: -97.6,
    urgency: 1,
    bandPosition: "aging",
    dateSource: "interval",
    targetAt: "2026-08-05",
    earliestAt: "2026-08-01", // strictly before PATH_DATE -> past-due
    latestAt: "2026-08-10",
    snoozeCount: 0,
    sourceOutcome: "appt_no_show",
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), // 5 days ago
    ...over,
  };
}

const appointment: MeetingStop = {
  id: "a1",
  kind: "appointment",
  title: "Renewal review",
  dealId: "d1",
  dealName: "Acme Payments",
  startAt: "2026-08-08T13:30:00Z",
  endAt: "2026-08-08T14:00:00Z",
  lat: 30.3,
  lng: -97.7,
  address: "100 Congress Ave",
  appointmentId: "a1",
  past: false,
};

function nativeStop(over: Partial<TodayStop> = {}): TodayStop {
  return {
    merchantId: "m1",
    name: "Nearby Cafe",
    address: "1 Nearby Rd",
    phone: null,
    lat: 30.28,
    lng: -97.72,
    category: "food",
    primaryType: null,
    status: "pending",
    disposition: null,
    notes: null,
    dealCreated: false,
    addedAt: "2026-08-08T08:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  meetingState.current = { stops: [], isLoading: false };
  owedState.current = { owed: [], isLoading: false };
  dueTodayState.current = { dueToday: [], isLoading: false };
  todayPathState.current = { stops: [], isLoading: false };
});

describe("useDrivingSequence", () => {
  it("composes meeting + past-due + due-today + pending native into ordered cards, excluding visited natives", () => {
    meetingState.current = { stops: [appointment], isLoading: false };
    owedState.current = { owed: [owedVisit()], isLoading: false };
    dueTodayState.current = {
      dueToday: [owedVisit({ taskId: "t2", dealId: "deal-due-1", name: "Due Today Co", earliestAt: PATH_DATE })],
      isLoading: false,
    };
    todayPathState.current = {
      stops: [
        nativeStop({ merchantId: "m-pending", name: "Pending Cafe", status: "pending" }),
        nativeStop({ merchantId: "m-visited", name: "Visited Cafe", status: "visited" }),
      ],
      isLoading: false,
    };

    const { result } = renderHook(() => useDrivingSequence(PATH_DATE, ORIGIN, NOW));

    expect(result.current.cards).toHaveLength(4);
    // The appointment is 4.5 hours out, so every flexible drop-in fits before
    // it and is woven in ahead of the anchor by time (not meetings-first).
    expect(result.current.cards.map((c) => c.kind)).toEqual([
      "owed",
      "owed",
      "nearby",
      "appointment",
    ]);
    // The visited native is absent; the pending one is the nearby card.
    expect(result.current.cards.find((c) => c.kind === "nearby")!.name).toBe("Pending Cafe");
    expect(result.current.cards.some((c) => c.name === "Visited Cafe")).toBe(false);
  });

  it("reports loading when any source is loading", () => {
    dueTodayState.current = { dueToday: [], isLoading: true };
    const { result } = renderHook(() => useDrivingSequence(PATH_DATE, ORIGIN, NOW));
    expect(result.current.isLoading).toBe(true);
  });

  it("is not loading when every source is settled", () => {
    const { result } = renderHook(() => useDrivingSequence(PATH_DATE, ORIGIN, NOW));
    expect(result.current.isLoading).toBe(false);
  });

  it("gives the past-due card a staleness reason line from createdAt", () => {
    owedState.current = {
      owed: [owedVisit({ createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString() })],
      isLoading: false,
    };
    const { result } = renderHook(() => useDrivingSequence(PATH_DATE, ORIGIN, NOW));
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].reason).toBe("You have not stopped by in 5 days.");
  });
});
