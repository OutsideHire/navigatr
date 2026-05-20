// Covers both link mutations: insert into partner_deals (attribute) and
// delete from partner_deals (unattribute). RLS denial + auth guards
// follow the same pattern as useCreatePartner / useLogActivity.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAttributeDeal, useUnattributeDeal } from "./useAttributeDeal";

// ---- supabase mock ----
const insertMock = vi.fn();
const eq2Mock = vi.fn();
const eq1Mock = vi.fn(() => ({ eq: eq2Mock }));
const deleteMock = vi.fn(() => ({ eq: eq1Mock }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: insertMock,
      delete: deleteMock,
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
  eq1Mock.mockClear();
  eq2Mock.mockReset();
  deleteMock.mockClear();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

describe("useAttributeDeal", () => {
  it("inserts a partner_deals row with org/partner/deal/attributed_by", async () => {
    insertMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useAttributeDeal(), {
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
    });
  });

  it("invalidates the partners list on success (re-fetches embedded attribution)", async () => {
    insertMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0]?.[0]?.queryKey).toEqual(["partners", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useAttributeDeal(), {
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
    const { result } = renderHook(() => useAttributeDeal(), {
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
    const { result } = renderHook(() => useAttributeDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});

describe("useUnattributeDeal", () => {
  it("deletes the partner_deals row matching the (partner_id, deal_id) pair", async () => {
    eq2Mock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUnattributeDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(eq1Mock).toHaveBeenCalledWith("partner_id", "p-1");
    expect(eq2Mock).toHaveBeenCalledWith("deal_id", "d-1");
  });

  it("invalidates the partners list on success", async () => {
    eq2Mock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUnattributeDeal(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0]?.[0]?.queryKey).toEqual(["partners", "list", "user-1"]);
  });

  it("surfaces Supabase errors", async () => {
    eq2Mock.mockResolvedValueOnce({
      error: { message: "permission denied for table partner_deals" },
    });
    const { result } = renderHook(() => useUnattributeDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
