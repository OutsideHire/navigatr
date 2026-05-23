// Tests the partial-update payload (camelCase → snake_case),
// .eq('id', x) WHERE clause, cache invalidation (deals always +
// stage_history when stage changes), and auth refusal. Stage-change
// is the most important use case — it's what unblocks the kanban.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useUpdateDeal } from "./useUpdateDeal";

const eqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ update: updateMock }) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  updateMock.mockClear();
  eqMock.mockReset();
  authUserId = "user-1";
});

describe("useUpdateDeal", () => {
  it("sends stage change as { stage } and matches by deal id", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ id: "deal-1", patch: { stage: "qualified" } });

    expect(updateMock).toHaveBeenCalledWith({ stage: "qualified" });
    expect(eqMock).toHaveBeenCalledWith("id", "deal-1");
  });

  it("translates camelCase patch keys to snake_case columns", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      id: "deal-1",
      patch: {
        companyName: "Acme Updated",
        valueCents: 250_000,
        nextFollowupAt: "2026-06-04T00:00:00Z",
        leadSource: "Inbound",
      },
    });
    expect(updateMock).toHaveBeenCalledWith({
      company_name: "Acme Updated",
      value_cents: 250_000,
      next_followup_at: "2026-06-04T00:00:00Z",
      lead_source: "Inbound",
    });
  });

  it("no-ops when the patch is empty (no Supabase call fires)", async () => {
    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ id: "deal-1", patch: {} });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("invalidates deals list AND stage history when stage changes", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateDeal(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ id: "deal-1", patch: { stage: "won" } });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["deals", "list", "user-1"]);
    expect(invalidatedKeys).toContainEqual(["stage-history", "list", "user-1"]);
  });

  it("only invalidates the deals list when stage is NOT in the patch", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateDeal(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ id: "deal-1", patch: { notes: "..." } });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["deals", "list", "user-1"]);
    // Stage history wasn't touched — no need to refetch the funnel
    expect(invalidatedKeys).not.toContainEqual(["stage-history", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ id: "deal-1", patch: { stage: "won" } }),
    ).rejects.toThrow(/not signed in/i);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("maps lostReasonCategory + lostReasonNotes to snake_case columns", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      id: "deal-1",
      patch: {
        lostReasonCategory: "price",
        lostReasonNotes: "Too high",
      },
    });
    expect(updateMock).toHaveBeenCalledWith({
      lost_reason_category: "price",
      lost_reason_notes: "Too high",
    });
  });

  it("surfaces RLS denial (rep editing a deal they don't own)", async () => {
    eqMock.mockResolvedValueOnce({
      error: { message: "permission denied for table deals" },
    });
    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ id: "deal-1", patch: { stage: "won" } }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
