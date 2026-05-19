// Regression: useProfile used to have staleTime: 0. Combined with multiple
// consumers (ProtectedRoute + any hook that needs org_id, e.g. useCreateDeal
// via AddDealSheet), every new mount triggered a background refetch, which
// flipped `isFetching` to true, which made ProtectedRoute return its
// spinner, which unmounted the page, which dropped the second consumer,
// which on remount restarted the cycle — an infinite render loop.
//
// The fix: a non-zero staleTime so mounting a second consumer of an
// already-fresh profile does NOT trigger a background refetch.
//
// This test catches anyone re-introducing staleTime: 0.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useProfile } from "./useProfile";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  maybeSingleMock.mockReset();
  selectMock.mockClear();
  eqMock.mockClear();
});

describe("useProfile", () => {
  it("does NOT background-refetch when a second consumer mounts shortly after the first (loop guard)", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "user-1", org_id: "org-1", role: "manager", full_name: "U", created_at: "now" },
      error: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = makeWrapper(client);

    // First consumer mounts (ProtectedRoute's call site).
    const first = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(maybeSingleMock).toHaveBeenCalledTimes(1);

    // Second consumer mounts (AddDealSheet → useCreateDeal → useProfile).
    // With staleTime: 0 this would have fired a second request and flipped
    // isFetching to true. With a healthy staleTime, no refetch happens.
    const second = renderHook(() => useProfile(), { wrapper });
    expect(second.result.current.isFetching).toBe(false);
    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
  });

  it("returns the profile mapped to the Profile shape", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "user-1",
        org_id: "org-1",
        role: "manager",
        full_name: "Ryan",
        created_at: "2026-05-18T13:24:35Z",
      },
      error: null,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProfile(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      id: "user-1",
      org_id: "org-1",
      role: "manager",
      full_name: "Ryan",
    });
  });

  it("throws on Supabase error so consumers' isError gates fire", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "500: relation profiles policy recursion" },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProfile(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
