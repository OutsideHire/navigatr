import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAddPartnerNote } from "./useAddPartnerNote";

const insertMock = vi.fn();
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
  insertMock.mockReset();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

describe("useAddPartnerNote", () => {
  it("inserts a snake_case row with org_id + created_by + body", async () => {
    insertMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useAddPartnerNote(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ partnerId: "p-1", body: "Prefers texts" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = (insertMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(payload).toMatchObject({
      org_id: "org-1",
      partner_id: "p-1",
      created_by: "user-1",
      body: "Prefers texts",
    });
  });

  it("invalidates ONLY the notes query, never the partners list", async () => {
    insertMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAddPartnerNote(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ partnerId: "p-1", body: "hi" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["partnerNotes", "byPartner", "user-1", "p-1"]);
    // A note is NOT contact — the partners list (last_touch_at) must NOT be busted.
    expect(keys).not.toContainEqual(["partners", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useAddPartnerNote(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", body: "hi" }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses when profile hasn't loaded", async () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useAddPartnerNote(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", body: "hi" }),
    ).rejects.toThrow(/profile/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces RLS / Supabase errors", async () => {
    insertMock.mockResolvedValueOnce({ error: { message: "row-level security" } });
    const { result } = renderHook(() => useAddPartnerNote(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", body: "hi" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});
