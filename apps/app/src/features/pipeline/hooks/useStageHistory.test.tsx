// Pins the row-shape mapping (snake → camel) and the disabled-when-anon
// behavior. The conversion funnel math is tested in useDashboardData;
// here we just verify the hook is a faithful read of deal_stage_history.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useStageHistory, STAGE_HISTORY_QUERY_KEY } from "./useStageHistory";

const orderMock = vi.fn();
const selectMock = vi.fn(() => ({ order: orderMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  orderMock.mockReset();
  selectMock.mockClear();
  authUserId = "user-1";
});

describe("useStageHistory", () => {
  it("maps Supabase rows to camelCase StageHistoryRow", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "h-1",
          deal_id: "d-1",
          from_stage: "new",
          to_stage: "contacted",
          transitioned_at: "2026-05-19T10:00:00Z",
        },
        // Initial-insert row has null from_stage
        {
          id: "h-2",
          deal_id: "d-1",
          from_stage: null,
          to_stage: "new",
          transitioned_at: "2026-05-18T08:00:00Z",
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useStageHistory(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: "h-1",
        dealId: "d-1",
        fromStage: "new",
        toStage: "contacted",
        transitionedAt: "2026-05-19T10:00:00Z",
      },
      {
        id: "h-2",
        dealId: "d-1",
        fromStage: null,
        toStage: "new",
        transitionedAt: "2026-05-18T08:00:00Z",
      },
    ]);
  });

  it("disabled when not signed in", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useStageHistory(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("surfaces Supabase errors", async () => {
    orderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for deal_stage_history" },
    });
    const { result } = renderHook(() => useStageHistory(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("cache key shape — useDashboardData's funnel computation depends on the contract", () => {
    expect(STAGE_HISTORY_QUERY_KEY("u-1")).toEqual(["stage-history", "list", "u-1"]);
    expect(STAGE_HISTORY_QUERY_KEY(undefined)).toEqual(["stage-history", "list", "anon"]);
  });
});
