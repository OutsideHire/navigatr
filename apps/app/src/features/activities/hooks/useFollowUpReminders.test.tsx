// Covers the bucketing logic (overdue / today / future), orphan handling
// (parent deal deleted), won-deal filtering (no follow-ups for closed
// deals), the "9+" cap is a UI concern handled in the bell component
// itself.

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useFollowUpReminders, dayDelta } from "./useFollowUpReminders";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

// Stub the underlying queries so we control input directly.
let activitiesData: Activity[] = [];
let dealsData: Deal[] = [];
vi.mock("./useActivities", () => ({
  useActivitiesForOrg: () => ({ data: activitiesData, isLoading: false }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: dealsData, isLoading: false }),
  DEALS_QUERY_KEY: () => ["deals", "list", "user-1"],
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    companyName: "Acme",
    contactName: "Jane",
    phone: "+15555555555",
    email: "j@acme.com",
    valueCents: 100_000,
    stage: "contacted",
    probability: 35,
    lastActivity: "2026-05-20T00:00:00Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "10-49",
    leadSource: "inbound",
    updatedAt: "2026-05-20T00:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
    ...overrides,
  };
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    dealId: "deal-1",
    type: "call",
    disposition: "positive_engagement",
    durationMinutes: 5,
    outcomeNotes: "",
    occurredAt: "2026-05-19T15:00:00Z",
    followUpDate: null,
    ...overrides,
  };
}

describe("dayDelta", () => {
  it("is 0 for same local day", () => {
    // Build via local-time constructor so the floor lands on the same
    // calendar day regardless of test-runner timezone.
    const a = new Date(2026, 4, 22, 9, 0, 0);
    const b = new Date(2026, 4, 22, 22, 0, 0);
    expect(dayDelta(a, b)).toBe(0);
  });
  it("is positive when 'other' is in the future", () => {
    const ref = new Date("2026-05-22T12:00:00Z");
    const future = new Date("2026-05-24T00:00:00Z");
    expect(dayDelta(ref, future)).toBeGreaterThan(0);
  });
  it("is negative when 'other' is in the past", () => {
    const ref = new Date("2026-05-22T12:00:00Z");
    const past = new Date("2026-05-19T00:00:00Z");
    expect(dayDelta(ref, past)).toBeLessThan(0);
  });
});

describe("useFollowUpReminders", () => {
  it("buckets follow-ups into overdue + today, drops future ones", () => {
    dealsData = [makeDeal()];
    activitiesData = [
      makeActivity({ id: "a-overdue", followUpDate: "2026-05-19T00:00:00Z" }),
      makeActivity({ id: "a-today",   followUpDate: "2026-05-22T00:00:00Z" }),
      makeActivity({ id: "a-future",  followUpDate: "2026-05-25T00:00:00Z" }),
    ];

    const { result } = renderHook(
      () => useFollowUpReminders(new Date("2026-05-22T12:00:00Z")),
      { wrapper },
    );

    expect(result.current.overdue.map((r) => r.id)).toEqual(["a-overdue"]);
    expect(result.current.today.map((r) => r.id)).toEqual(["a-today"]);
    expect(result.current.count).toBe(2);
  });

  it("skips activities whose parent deal was deleted (orphan)", () => {
    dealsData = []; // deal vanished
    activitiesData = [
      makeActivity({ followUpDate: "2026-05-22T00:00:00Z" }),
    ];
    const { result } = renderHook(
      () => useFollowUpReminders(new Date("2026-05-22T12:00:00Z")),
      { wrapper },
    );
    expect(result.current.count).toBe(0);
  });

  it("skips activities on closed-won deals", () => {
    dealsData = [makeDeal({ stage: "won" })];
    activitiesData = [
      makeActivity({ followUpDate: "2026-05-22T00:00:00Z" }),
    ];
    const { result } = renderHook(
      () => useFollowUpReminders(new Date("2026-05-22T12:00:00Z")),
      { wrapper },
    );
    expect(result.current.count).toBe(0);
  });

  it("ignores activities with no follow-up date", () => {
    dealsData = [makeDeal()];
    activitiesData = [makeActivity({ followUpDate: null })];
    const { result } = renderHook(
      () => useFollowUpReminders(new Date("2026-05-22T12:00:00Z")),
      { wrapper },
    );
    expect(result.current.count).toBe(0);
  });

  it("sorts overdue oldest-first (most urgent at the top)", () => {
    dealsData = [makeDeal(), makeDeal({ id: "deal-2", companyName: "Beta" })];
    activitiesData = [
      makeActivity({ id: "newer", dealId: "deal-1", followUpDate: "2026-05-20T00:00:00Z" }),
      makeActivity({ id: "older", dealId: "deal-2", followUpDate: "2026-05-15T00:00:00Z" }),
    ];
    const { result } = renderHook(
      () => useFollowUpReminders(new Date("2026-05-22T12:00:00Z")),
      { wrapper },
    );
    expect(result.current.overdue.map((r) => r.id)).toEqual(["older", "newer"]);
  });

  it("reports daysOverdue as a positive count for overdue items", () => {
    dealsData = [makeDeal()];
    activitiesData = [
      makeActivity({ id: "a", followUpDate: "2026-05-19T00:00:00Z" }),
    ];
    const { result } = renderHook(
      () => useFollowUpReminders(new Date("2026-05-22T12:00:00Z")),
      { wrapper },
    );
    expect(result.current.overdue[0].daysOverdue).toBe(3);
  });

  it("reports daysOverdue as 0 for due-today items", () => {
    dealsData = [makeDeal()];
    activitiesData = [
      makeActivity({ id: "a", followUpDate: "2026-05-22T00:00:00Z" }),
    ];
    const { result } = renderHook(
      () => useFollowUpReminders(new Date("2026-05-22T12:00:00Z")),
      { wrapper },
    );
    expect(result.current.today[0].daysOverdue).toBe(0);
  });
});
