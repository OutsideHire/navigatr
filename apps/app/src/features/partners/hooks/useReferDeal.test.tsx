// Covers the outbound referral mutation: insert into partner_deals with
// direction "outbound". RLS denial + auth/profile guards follow the same
// pattern as useAttributeDeal.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useReferDeal } from "./useReferDeal";

// ---- supabase mock ----
const insertMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: insertMock,
    }),
  },
}));

let authUserId: string | undefined;
let profileOrgId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: profileOrgId ? { org_id: profileOrgId } : null }),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  insertMock.mockReset();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

describe("useReferDeal", () => {
  it("inserts a partner_deals row with direction outbound + org/partner/deal/attributed_by", async () => {
    insertMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useReferDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1", notes: "Q3 referral" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0]?.[0]).toMatchObject({
      org_id: "org-1",
      partner_id: "p-1",
      deal_id: "d-1",
      attributed_by: "user-1",
      notes: "Q3 referral",
      direction: "outbound",
    });
  });

  it("invalidates the partners list on success (re-fetches embedded attribution)", async () => {
    insertMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useReferDeal(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0]?.[0]?.queryKey).toEqual(["partners", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useReferDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses when profile hasn't loaded", async () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useReferDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }),
    ).rejects.toThrow(/profile/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces RLS denial", async () => {
    insertMock.mockResolvedValueOnce({
      error: { message: "new row violates row-level security policy" },
    });
    const { result } = renderHook(() => useReferDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});
