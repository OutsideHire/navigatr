// Covers the form → insert payload translation (camelCase → snake_case,
// follow_up_date trimmed to YYYY-MM-DD), the org/owner derivation from
// session + profile, error propagation, and the dual cache-invalidation
// on success (both per-deal activities and the org-wide deals list).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useLogActivity } from "./useLogActivity";

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

describe("useLogActivity", () => {
  it("translates the form input to a snake_case insert payload", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "act-new" }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useLogActivity(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync({
      dealId: "deal-1",
      type: "call",
      disposition: "positive_engagement",
      durationMinutes: 23,
      outcomeNotes: "Good chat",
      occurredAt: "2026-05-19T12:00:00.000Z",
      followUpDate: "2026-05-22T00:00:00.000Z",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const payload = calls[0]?.[0];
    expect(payload).toMatchObject({
      org_id: "org-1",
      deal_id: "deal-1",
      logged_by: "user-1",
      type: "call",
      disposition: "positive_engagement",
      duration_minutes: 23,
      outcome_notes: "Good chat",
      occurred_at: "2026-05-19T12:00:00.000Z",
      // ISO timestamp → DB DATE (just the YYYY-MM-DD prefix)
      follow_up_date: "2026-05-22",
    });
  });

  it("null follow_up_date is preserved (terminal dispositions don't schedule)", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "act-x" }, error: null });
    const { result } = renderHook(() => useLogActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      dealId: "deal-1",
      type: "call",
      disposition: "not_interested",
      followUpDate: null,
    });
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const payload = calls[0]?.[0];
    expect(payload?.follow_up_date).toBeNull();
  });

  it("invalidates all three caches on success: per-deal activities, org-wide activities, deals list", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "act-z" }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useLogActivity(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync({
      dealId: "deal-1",
      type: "call",
      disposition: "positive_engagement",
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    // Per-deal activities query — used by DealDetailPage's timeline
    expect(invalidatedKeys).toContainEqual(["activities", "byDeal", "user-1", "deal-1"]);
    // Org-wide activities query — used by ActivitiesPage's tabs
    expect(invalidatedKeys).toContainEqual(["activities", "list", "user-1"]);
    // Deals list — the sync trigger updates last_activity_at + next_followup_at
    expect(invalidatedKeys).toContainEqual(["deals", "list", "user-1"]);
  });

  it("writes voice_note_url when voiceNoteUrl is provided", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    const { result } = renderHook(() => useLogActivity(), { wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) });
    await result.current.mutateAsync({ dealId: "d1", type: "drop_in", disposition: "statement_secured", voiceNoteUrl: "user-1/x.webm" });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ voice_note_url: "user-1/x.webm" }));
  });
  it("writes voice_note_url null when omitted", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    const { result } = renderHook(() => useLogActivity(), { wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) });
    await result.current.mutateAsync({ dealId: "d1", type: "drop_in", disposition: "not_interested" });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ voice_note_url: null }));
  });

  it("throws when not signed in (no Supabase call fires)", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useLogActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({
        dealId: "d", type: "call", disposition: "positive_engagement",
      }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws when profile hasn't loaded yet (no org_id) so we don't bypass RLS with a guess", async () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useLogActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({
        dealId: "d", type: "call", disposition: "positive_engagement",
      }),
    ).rejects.toThrow(/profile/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces Supabase errors (RLS denial, FK violation, etc.)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "new row violates row-level security policy" },
    });
    const { result } = renderHook(() => useLogActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({
        dealId: "d", type: "call", disposition: "positive_engagement",
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});
