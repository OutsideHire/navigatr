import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const orderMock = vi.fn();
const rpcMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return orderMock(); },
      };
      return chain;
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

import { useReinstatableReferrals, useReinstateReferral } from "./useReinstateReferral";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => {
  orderMock.mockReset();
  rpcMock.mockReset();
  calls.length = 0;
});

describe("useReinstatableReferrals", () => {
  it("reads this partner's declined duplicates that can come back, oldest first", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{ id: "r-1", company_name: "Dup One", submitted_at: "2026-10-10T12:00:00Z" }],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReinstatableReferrals("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "r-1", companyName: "Dup One", submittedAt: "2026-10-10T12:00:00Z" }]);
    expect(calls).toEqual([
      ["from", "referrals"],
      ["select", "id, company_name, submitted_at"],
      ["eq", "partner_id", "p-1"],
      ["eq", "status", "declined"],
      ["eq", "can_reinstate", true],
      ["order", "submitted_at", { ascending: true }],
    ]);
  });

  it("does not query without a partner", () => {
    const { wrapper } = setup();
    renderHook(() => useReinstatableReferrals(undefined), { wrapper });
    expect(calls).toEqual([]);
  });
});

describe("useReinstateReferral", () => {
  it("reinstates and refreshes every referrals query", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useReinstateReferral(), { wrapper });
    await result.current.mutateAsync("r-1");
    expect(rpcMock).toHaveBeenCalledWith("reinstate_referral", { p_referral_id: "r-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] }));
  });

  it("turns a refusal into plain words", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "referral_not_reinstatable" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReinstateReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("This referral can't be reinstated now.");
  });
});
