import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDealReferral } from "./useDealReferral";

const maybeSingleMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        not: (...a: unknown[]) => { calls.push(["not", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return chain; },
        limit: (...a: unknown[]) => { calls.push(["limit", ...a]); return chain; },
        maybeSingle: maybeSingleMock,
      };
      return chain;
    },
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { maybeSingleMock.mockReset(); calls.length = 0; });

describe("useDealReferral", () => {
  it("returns the earliest live inbound referral for the deal", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "r-1", partner_id: "p-1", partner: { name: "Jane", company: "Jane & Co" } }, error: null,
    });
    const { result } = renderHook(() => useDealReferral("d-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ referralId: "r-1", partnerId: "p-1", partnerName: "Jane", partnerCompany: "Jane & Co" });
    expect(calls).toContainEqual(["eq", "deal_id", "d-1"]);
    expect(calls).toContainEqual(["eq", "direction", "inbound"]);
    expect(calls).toContainEqual(["not", "status", "in", "(declined,withdrawn)"]);
  });

  it("returns null when the deal has no referral", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useDealReferral("d-2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not run without a deal id", () => {
    const { result } = renderHook(() => useDealReferral(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
