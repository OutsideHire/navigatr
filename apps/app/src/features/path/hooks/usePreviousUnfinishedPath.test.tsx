import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePreviousUnfinishedPath } from "./usePreviousUnfinishedPath";

const orderMock = vi.fn();
const neqMock = vi.fn(() => ({ order: orderMock }));
const ltMock = vi.fn(() => ({ neq: neqMock }));
const selectMock = vi.fn(() => ({ lt: ltMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));
vi.mock("../lib/today", () => ({ todayISO: () => "2026-06-08" }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => { orderMock.mockReset(); });

describe("usePreviousUnfinishedPath", () => {
  it("returns the most-recent past path that has pending stops, with the pending count", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        { id: "p7", path_date: "2026-06-07", status: "planned", path_stops: [
          { status: "visited" }, { status: "pending" }, { status: "pending" } ] },
        { id: "p6", path_date: "2026-06-06", status: "planned", path_stops: [
          { status: "pending" } ] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePreviousUnfinishedPath(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ltMock).toHaveBeenCalledWith("path_date", "2026-06-08");
    expect(neqMock).toHaveBeenCalledWith("status", "completed");
    expect(result.current.data).toEqual({ pathId: "p7", pathDate: "2026-06-07", pendingCount: 2 });
  });

  it("skips the most-recent path if it has no pending stops and falls back to an older one", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        { id: "p7", path_date: "2026-06-07", status: "planned", path_stops: [
          { status: "visited" }, { status: "skipped" } ] },
        { id: "p6", path_date: "2026-06-06", status: "planned", path_stops: [
          { status: "pending" } ] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePreviousUnfinishedPath(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ pathId: "p6", pathDate: "2026-06-06", pendingCount: 1 });
  });

  it("returns null when no past path has pending stops", async () => {
    orderMock.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => usePreviousUnfinishedPath(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
