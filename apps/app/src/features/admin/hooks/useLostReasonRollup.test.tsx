// Smoke coverage for the lost-reason rollup hook. Verifies the RPC name,
// window-days param shape, error pass-through, and that result rows preserve
// the server's order (count desc, then $$ desc).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useLostReasonRollup } from "./useLostReasonRollup";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("useLostReasonRollup", () => {
  it("calls lost_reason_rollup with the window days", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useLostReasonRollup(30), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("lost_reason_rollup", { p_window_days: 30 });
  });

  it("returns rows from the RPC verbatim (server controls ordering)", async () => {
    const rows = [
      { category: "price", deal_count: 5, lost_value_cents: 500000 },
      { category: "competitor", deal_count: 3, lost_value_cents: 300000 },
    ];
    rpcMock.mockResolvedValueOnce({ data: rows, error: null });
    const { result } = renderHook(() => useLostReasonRollup(7), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
  });

  it("surfaces RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(() => useLostReasonRollup(90), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("permission denied");
  });

  it("normalises null data to an empty array", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useLostReasonRollup(30), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
