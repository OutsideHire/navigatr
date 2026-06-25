import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCoverageRollup } from "./useCoverageRollup";

let rows: unknown[];
let err: Error | null;
// Vitest 4 hoists vi.mock factories above top-level const initializers (no more
// `mock`-prefixed-variable exception), so a plain `const rpcMock` referenced in
// the factory hits its TDZ. vi.hoisted lifts the spy with the factory; the test
// body and assertions are unchanged.
const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(() => Promise.resolve({ data: err ? null : rows, error: err })),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "mgr" } }),
}));

function wrapper() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

beforeEach(() => { rows = []; err = null; rpcMock.mockClear(); });

describe("useCoverageRollup", () => {
  it("calls the coverage_rollup RPC and maps rows to camelCase", async () => {
    rows = [{
      user_id: "u1", full_name: "Alex", role: "rep", snapshot_date: "2026-06-25",
      composite_coverage: 0.8, confidence_level: "low", call_coverage: 0.8,
      call_event_count: 12, active_channels: ["phone"],
    }];
    const { result } = renderHook(() => useCoverageRollup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    expect(rpcMock).toHaveBeenCalledWith("coverage_rollup");
    expect(result.current.rows[0]).toEqual({
      userId: "u1", fullName: "Alex", role: "rep", snapshotDate: "2026-06-25",
      compositeCoverage: 0.8, confidenceLevel: "low", callCoverage: 0.8,
      callEventCount: 12, activeChannels: ["phone"],
    });
  });

  it("returns [] on error", async () => {
    err = new Error("forbidden");
    const { result } = renderHook(() => useCoverageRollup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows).toEqual([]);
  });
});
