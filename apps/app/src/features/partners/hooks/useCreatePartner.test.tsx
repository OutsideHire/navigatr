// Covers the form → insert payload translation, org/created_by derivation
// from session + profile, error propagation, and cache invalidation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useCreatePartner } from "./useCreatePartner";

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const insertMock = vi.fn(() => ({ select: selectMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ insert: insertMock }) },
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
  insertMock.mockClear();
  selectMock.mockClear();
  singleMock.mockReset();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

describe("useCreatePartner", () => {
  it("inserts with snake_case columns + org_id + created_by from session", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "p-new" }, error: null });
    const { result } = renderHook(() => useCreatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      name: "Sarah Johnson",
      company: "Johnson & Boyle CPAs",
      type: "cpa_bookkeeper",
      phone: "+12025550101",
      email: "sarah@johnson.com",
      city: "Austin, TX",
      notes: "Best CPA",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const payload = calls[0]?.[0];
    expect(payload).toMatchObject({
      org_id: "org-1",
      created_by: "user-1",
      name: "Sarah Johnson",
      company: "Johnson & Boyle CPAs",
      type: "cpa_bookkeeper",
      // default status when not provided
      status: "active",
      phone: "+12025550101",
      email: "sarah@johnson.com",
      city: "Austin, TX",
      notes: "Best CPA",
    });
  });

  it("status defaults to 'active' when not provided", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "p-z" }, error: null });
    const { result } = renderHook(() => useCreatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      name: "X", company: "X", type: "other",
    });
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]?.status).toBe("active");
  });

  it("invalidates the partners list cache on success", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "p-z" }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreatePartner(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync({
      name: "X", company: "X", type: "other",
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0]?.[0]?.queryKey).toEqual(["partners", "list", "user-1"]);
  });

  it("throws when not signed in (no Supabase call fires)", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useCreatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ name: "X", company: "X", type: "other" }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws when profile hasn't loaded yet (no org_id)", async () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useCreatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ name: "X", company: "X", type: "other" }),
    ).rejects.toThrow(/profile/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces Supabase errors (RLS denial)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "new row violates row-level security policy" },
    });
    const { result } = renderHook(() => useCreatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ name: "X", company: "X", type: "other" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});
