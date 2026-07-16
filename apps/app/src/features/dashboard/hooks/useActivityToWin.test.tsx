import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActivityToWin } from "./useActivityToWin";
import { resolveRange } from "../lib/dateRange";
import type { Deal } from "@/features/pipeline/mockData";

function won(o: Partial<Deal> & { id: string }): Deal {
  return {
    id: o.id, companyName: o.id, contactName: "C", phone: "", email: "",
    valueCents: 50_000_00, stage: "won", probability: 100,
    lastActivity: "2026-06-01T00:00:00.000Z", nextFollowup: null, address: null,
    employeeCountRange: "1-9", leadSource: "", updatedAt: "2026-06-01T00:00:00.000Z",
    owner_id: "u1", lostReasonCategory: null, lostReasonNotes: null,
    closedWonAt: "2026-06-15T00:00:00.000Z", firstActivityAt: "2026-06-01T00:00:00.000Z",
    activityCountTotal: o.activityCountTotal ?? 5, timeToWinBusinessDays: o.timeToWinBusinessDays ?? 6,
    timeToWinCalendarDays: 8, industry: null,
  };
}

const DEALS: Deal[] = [
  won({ id: "a", activityCountTotal: 4, timeToWinBusinessDays: 5 }),
  won({ id: "b", activityCountTotal: 6, timeToWinBusinessDays: 7 }),
  won({ id: "c", activityCountTotal: 8, timeToWinBusinessDays: 9 }),
];
vi.mock("@/features/pipeline/hooks/useDeals", () => ({ useDeals: () => ({ data: DEALS }) }));

describe("useActivityToWin", () => {
  it("returns the computed aggregate for the RLS-scoped deals", () => {
    const range = resolveRange("all", new Date("2026-07-16T00:00:00.000Z"));
    const { result } = renderHook(() => useActivityToWin(range));
    expect(result.current.sampleSize).toBe(3);
    expect(result.current.insufficientData).toBe(false);
    expect(result.current.medianTotal).toBe(6);
    expect(result.current.medianBusinessDays).toBe(7);
  });
});
