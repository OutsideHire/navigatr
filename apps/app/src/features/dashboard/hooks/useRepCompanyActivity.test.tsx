import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRepCompanyActivity } from "./useRepCompanyActivity";
import { resolveRange } from "../lib/dateRange";

vi.mock("@/features/activities/hooks/useActivities", () => ({
  useActivitiesForOrg: () => ({
    data: [
      { id: "a1", dealId: "d1", type: "call", occurredAt: "2026-03-01T00:00:00.000Z", loggedBy: "u1" },
      { id: "a2", dealId: "d1", type: "email", occurredAt: "2026-03-02T00:00:00.000Z", loggedBy: "u1" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: [{ id: "d1", owner_id: "u1", companyName: "Acme" }], isLoading: false }),
}));
vi.mock("../hooks/useOrgMemberNames", () => ({
  useOrgMemberNames: () => new Map([["u1", "Dana W"]]),
}));

describe("useRepCompanyActivity", () => {
  it("aggregates activities joined to their deal owner and company", () => {
    const range = resolveRange("all", new Date("2026-06-01T00:00:00.000Z"));
    const { result } = renderHook(() => useRepCompanyActivity(range));
    expect(result.current.reps).toHaveLength(1);
    expect(result.current.reps[0]!.counts.total).toBe(2);
    expect(result.current.nameOf("u1")).toBe("Dana W");
    expect(result.current.grandTotal.total).toBe(2);
  });

  it("nameOf falls back to Unassigned (null) and Unknown rep (missing id)", () => {
    const range = resolveRange("all", new Date("2026-06-01T00:00:00.000Z"));
    const { result } = renderHook(() => useRepCompanyActivity(range));
    expect(result.current.nameOf(null)).toBe("Unassigned");
    expect(result.current.nameOf("u999")).toBe("Unknown rep");
  });
});
