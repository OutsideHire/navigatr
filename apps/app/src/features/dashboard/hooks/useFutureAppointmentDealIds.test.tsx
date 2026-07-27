import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useFutureAppointmentDealIds, withFutureAppointmentFlag } from "./useFutureAppointmentDealIds";
import type { Deal } from "@/features/pipeline/mockData";

// Chainable builder mock: .select().eq("status", "scheduled").gt("start_at", now) is terminal.
const eqMock = vi.fn();
const gtMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (...args: unknown[]) => {
          eqMock(...args);
          return { gt: (...gtArgs: unknown[]) => gtMock(...gtArgs) };
        },
      }),
    }),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  eqMock.mockReset();
  gtMock.mockReset();
});

describe("useFutureAppointmentDealIds", () => {
  it("maps rows to a Set of deal_ids, filtered to scheduled + future start_at", async () => {
    gtMock.mockResolvedValueOnce({
      data: [{ deal_id: "deal-1" }, { deal_id: "deal-2" }],
      error: null,
    });
    const { result } = renderHook(() => useFutureAppointmentDealIds(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(new Set(["deal-1", "deal-2"]));
    expect(eqMock).toHaveBeenCalledWith("status", "scheduled");
    expect(gtMock).toHaveBeenCalledWith("start_at", expect.any(String));
  });

  it("returns an empty Set on a query error", async () => {
    gtMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useFutureAppointmentDealIds(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(new Set());
  });

  it("returns an empty Set when data is null but no error", async () => {
    gtMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useFutureAppointmentDealIds(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(new Set());
  });
});

describe("withFutureAppointmentFlag", () => {
  const deal = (id: string): Deal => ({
    id,
    companyName: "Acme",
    contactName: "C",
    phone: "",
    email: "",
    valueCents: 0,
    stage: "qualified",
    probability: 50,
    lastActivity: "2026-06-01T00:00:00.000Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "",
    leadSource: "",
    updatedAt: "2026-06-01T00:00:00.000Z",
    owner_id: "u1",
    lostReasonCategory: null,
    lostReasonNotes: null,
  });

  it("sets has_future_appointment true for deal ids present in the set", () => {
    const [d1, d2] = withFutureAppointmentFlag([deal("d1"), deal("d2")], new Set(["d1"]));
    expect(d1.has_future_appointment).toBe(true);
    expect(d2.has_future_appointment).toBe(false);
  });

  it("defaults to false (no exclusion) for an empty set", () => {
    const [d1] = withFutureAppointmentFlag([deal("d1")], new Set());
    expect(d1.has_future_appointment).toBe(false);
  });
});
