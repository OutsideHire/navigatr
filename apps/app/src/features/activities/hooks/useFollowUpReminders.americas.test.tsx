// Bug C regression — the notification bell.
//
// Runs in America/Los_Angeles. A follow-up scheduled for Jul 9 must not show
// as "due today" on the evening of Jul 8 (rep's local time). Pre-fix, dayDelta
// floored both the follow-up instant and "now" to LOCAL midnight, so a
// midnight-UTC-hydrated Jul-9 follow-up read as Jul 8 → delta 0 → "due today".
process.env.TZ = "America/Los_Angeles";

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useFollowUpReminders } from "./useFollowUpReminders";
import { dateOnlyToNoonUtcIso } from "@/lib/calendarDate";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

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

function makeDeal(): Deal {
  return {
    id: "deal-1",
    companyName: "Acme",
    contactName: "Jane",
    phone: "+15555555555",
    email: "j@acme.com",
    valueCents: 100_000,
    stage: "contacted",
    probability: 35,
    lastActivity: "2026-07-08T00:00:00Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "10-49",
    leadSource: "inbound",
    updatedAt: "2026-07-08T00:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

function makeActivity(followUpDate: string | null): Activity {
  return {
    id: "act-1",
    dealId: "deal-1",
    type: "call",
    disposition: "positive_engagement",
    durationMinutes: 5,
    outcomeNotes: "",
    occurredAt: "2026-07-08T02:00:00Z",
    followUpDate,
  };
}

// Rep's clock: 2026-07-09T02:00Z = 2026-07-08 19:00 PDT.
const NOW_JUL8_EVENING = new Date("2026-07-09T02:00:00Z");

describe("useFollowUpReminders — Americas (negative-UTC) evening", () => {
  it("a Jul-9 follow-up is NOT due on the evening of Jul 8 (noon-UTC hydration)", () => {
    dealsData = [makeDeal()];
    activitiesData = [makeActivity(dateOnlyToNoonUtcIso("2026-07-09"))];

    const { result } = renderHook(
      () => useFollowUpReminders(NOW_JUL8_EVENING),
      { wrapper },
    );

    expect(result.current.today).toHaveLength(0);
    expect(result.current.overdue).toHaveLength(0);
    expect(result.current.count).toBe(0);
  });

  it("is robust to the legacy midnight-UTC representation too", () => {
    dealsData = [makeDeal()];
    activitiesData = [makeActivity("2026-07-09T00:00:00.000Z")];

    const { result } = renderHook(
      () => useFollowUpReminders(NOW_JUL8_EVENING),
      { wrapper },
    );

    expect(result.current.count).toBe(0);
  });

  it("the same follow-up IS due once the rep's local day rolls to Jul 9", () => {
    dealsData = [makeDeal()];
    activitiesData = [makeActivity(dateOnlyToNoonUtcIso("2026-07-09"))];

    // 2026-07-09T20:00Z = 2026-07-09 13:00 PDT.
    const { result } = renderHook(
      () => useFollowUpReminders(new Date("2026-07-09T20:00:00Z")),
      { wrapper },
    );

    expect(result.current.today.map((r) => r.id)).toEqual(["act-1"]);
    expect(result.current.count).toBe(1);
  });
});
