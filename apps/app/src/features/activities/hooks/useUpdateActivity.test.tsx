// Mirror of useUpdateDeal tests: partial-update payload (camelCase →
// snake_case), .eq('id', x), invalidation (per-deal + org-wide + deals
// list), no-op when patch is empty, auth refusal, RLS denial.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useUpdateActivity } from "./useUpdateActivity";

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

describe("useUpdateActivity", () => {
  it("translates camelCase patch keys to snake_case columns", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdateActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      id: "act-1",
      dealId: "deal-1",
      patch: {
        durationMinutes: 12,
        disposition: "positive_engagement",
        outcomeNotes: "Great call",
      },
    });

    expect(updateMock).toHaveBeenCalledWith({
      duration_minutes: 12,
      disposition: "positive_engagement",
      outcome_notes: "Great call",
    });
    expect(eqMock).toHaveBeenCalledWith("id", "act-1");
  });

  it("strips time portion from followUpDate (DATE column)", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdateActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      id: "act-1",
      dealId: "deal-1",
      patch: { followUpDate: "2026-06-04T00:00:00Z" },
    });

    expect(updateMock).toHaveBeenCalledWith({ follow_up_date: "2026-06-04" });
  });

  it("clears followUpDate as null when patch sets it to null", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdateActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      id: "act-1",
      dealId: "deal-1",
      patch: { followUpDate: null },
    });

    expect(updateMock).toHaveBeenCalledWith({ follow_up_date: null });
  });

  it("no-ops when the patch is empty", async () => {
    const { result } = renderHook(() => useUpdateActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ id: "act-1", dealId: "deal-1", patch: {} });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("invalidates per-deal activities, org activities, AND deals list", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateActivity(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({
      id: "act-1",
      dealId: "deal-1",
      patch: { outcomeNotes: "Updated" },
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["activities", "byDeal", "user-1", "deal-1"]);
    expect(invalidatedKeys).toContainEqual(["activities", "list", "user-1"]);
    expect(invalidatedKeys).toContainEqual(["deals", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useUpdateActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ id: "act-1", dealId: "deal-1", patch: { outcomeNotes: "x" } }),
    ).rejects.toThrow(/not signed in/i);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("surfaces RLS denial (rep editing someone else's activity)", async () => {
    eqMock.mockResolvedValueOnce({
      error: { message: "permission denied for table activities" },
    });
    const { result } = renderHook(() => useUpdateActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ id: "act-1", dealId: "deal-1", patch: { outcomeNotes: "x" } }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
