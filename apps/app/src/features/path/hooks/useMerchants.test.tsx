// Tests the deal → Merchant mapping: stage→status, address fallback,
// lat/lng absence (NaN sentinel), and pass-through of contact fields.
//
// We stub useDeals so this is a pure unit test of the mapping logic.

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useMerchants } from "./useMerchants";
import type { Deal } from "@/features/pipeline/mockData";

let dealsData: Deal[] = [];
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: dealsData, isLoading: false, isError: false }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "d-1",
    companyName: "Acme",
    contactName: "Jane",
    phone: "+15555555555",
    email: "j@acme.com",
    valueCents: 100_000,
    stage: "contacted",
    probability: 35,
    lastActivity: "2026-05-20T00:00:00Z",
    nextFollowup: null,
    address: "123 Main St",
    employeeCountRange: "10-49",
    leadSource: "inbound",
    updatedAt: "2026-05-20T00:00:00Z",
    owner_id: null,
    ...overrides,
  };
}

describe("useMerchants", () => {
  it("maps a deal into a Merchant with stage-derived status", () => {
    dealsData = [
      makeDeal({ id: "a", stage: "new" }),
      makeDeal({ id: "b", stage: "contacted" }),
      makeDeal({ id: "c", stage: "qualified" }),
      makeDeal({ id: "d", stage: "proposal" }),
      makeDeal({ id: "e", stage: "won" }),
    ];
    const { result } = renderHook(() => useMerchants(), { wrapper });

    expect(result.current.merchants.map((m) => [m.id, m.status])).toEqual([
      ["a", "untouched"],
      ["b", "prospect"],
      ["c", "active"],
      ["d", "active"],
      ["e", "won"],
    ]);
  });

  it("uses the deal's companyName + contact fields verbatim", () => {
    dealsData = [makeDeal({ companyName: "Sunset Cafe", phone: "+15125550101", email: "owner@sunset.com" })];
    const { result } = renderHook(() => useMerchants(), { wrapper });
    const m = result.current.merchants[0]!;
    expect(m.name).toBe("Sunset Cafe");
    expect(m.phone).toBe("+15125550101");
    expect(m.email).toBe("owner@sunset.com");
  });

  it("falls back to 'Address not set' when the deal has no address", () => {
    dealsData = [makeDeal({ address: null })];
    const { result } = renderHook(() => useMerchants(), { wrapper });
    expect(result.current.merchants[0]!.address).toBe("Address not set");
  });

  it("uses NaN sentinels for lat/lng (un-geocoded deals)", () => {
    dealsData = [makeDeal()];
    const { result } = renderHook(() => useMerchants(), { wrapper });
    expect(Number.isNaN(result.current.merchants[0]!.lat)).toBe(true);
    expect(Number.isNaN(result.current.merchants[0]!.lng)).toBe(true);
  });

  it("returns an empty list when the user has no deals", () => {
    dealsData = [];
    const { result } = renderHook(() => useMerchants(), { wrapper });
    expect(result.current.merchants).toEqual([]);
  });

  it("omits email when it's an empty string", () => {
    dealsData = [makeDeal({ email: "" })];
    const { result } = renderHook(() => useMerchants(), { wrapper });
    expect(result.current.merchants[0]!.email).toBeUndefined();
  });
});
