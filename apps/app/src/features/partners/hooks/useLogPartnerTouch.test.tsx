// Covers the camelCase → snake_case payload, follow-up-date trimming,
// dual cache invalidation (per-partner timeline + partners list), auth
// guards, and error propagation. Same shape as useLogActivity's tests.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useLogPartnerTouch } from "./useLogPartnerTouch";

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

describe("useLogPartnerTouch", () => {
  it("translates the form input to a snake_case insert", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "touch-new" }, error: null });
    const { result } = renderHook(() => useLogPartnerTouch(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      partnerId: "p-1",
      type: "call",
      notes: "Quarterly sync — they have 3 referrals coming.",
      durationMinutes: 25,
      occurredAt: "2026-05-21T15:00:00.000Z",
      followUpDate: "2026-06-04T00:00:00.000Z",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const payload = calls[0]?.[0];
    expect(payload).toMatchObject({
      org_id: "org-1",
      partner_id: "p-1",
      logged_by: "user-1",
      type: "call",
      notes: "Quarterly sync — they have 3 referrals coming.",
      duration_minutes: 25,
      occurred_at: "2026-05-21T15:00:00.000Z",
      follow_up_date: "2026-06-04",
    });
  });

  it("null follow_up_date stays null (notes-only touches don't schedule)", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "t-x" }, error: null });
    const { result } = renderHook(() => useLogPartnerTouch(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      partnerId: "p-1",
      type: "note",
      notes: "FYI — they moved offices.",
    });
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]?.follow_up_date).toBeNull();
  });

  it("invalidates BOTH per-partner timeline and partners list on success", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "t-z" }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useLogPartnerTouch(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync({
      partnerId: "p-1",
      type: "call",
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    // Per-partner timeline — drives the TouchTimelineCard refetch
    expect(invalidatedKeys).toContainEqual(["partnerActivities", "byPartner", "user-1", "p-1"]);
    // Partners list — sync trigger updated last_touch_at + next_followup_at
    expect(invalidatedKeys).toContainEqual(["partners", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useLogPartnerTouch(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", type: "call" }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses when profile hasn't loaded yet", async () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useLogPartnerTouch(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", type: "call" }),
    ).rejects.toThrow(/profile/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces RLS denial / Supabase errors", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "new row violates row-level security policy" },
    });
    const { result } = renderHook(() => useLogPartnerTouch(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ partnerId: "p-1", type: "call" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});
