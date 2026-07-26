import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { usePersistenceCompanySeries } from "./usePersistenceCompanySeries";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("usePersistenceCompanySeries", () => {
  it("maps rows to CompanySeriesPoint", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { snapshot_date: "2026-07-01", composite_median: 62, composite_p90: 88, rep_count: 5 },
        { snapshot_date: "2026-07-02", composite_median: 64, composite_p90: 90, rep_count: 5 },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePersistenceCompanySeries(30), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { date: "2026-07-01", median: 62, p90: 88, repCount: 5 },
      { date: "2026-07-02", median: 64, p90: 90, repCount: 5 },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("persistence_company_series", { p_range_days: 30 });
  });

  it("returns [] on RPC error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => usePersistenceCompanySeries(30), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("returns [] when data is null but no error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => usePersistenceCompanySeries(7), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
