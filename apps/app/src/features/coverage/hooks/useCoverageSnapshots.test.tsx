import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCoverageSnapshots } from "./useCoverageSnapshots";

let rows: Array<Record<string, unknown>>;
let err: Error | null;
let orderSpy: ReturnType<typeof vi.fn>;
function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit"]) b[m] = vi.fn(() => b);
  orderSpy = b.order as ReturnType<typeof vi.fn>;
  b.then = (resolve: (v: { data: unknown[] | null; error: Error | null }) => void) =>
    resolve({ data: err ? null : rows, error: err });
  return b;
}
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => builder() } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "u1" } }),
}));

function wrapper() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

const snap = (d: string, composite: number, conf = "low") => ({
  snapshot_date: d, composite_coverage: composite, confidence_level: conf,
  call_coverage: composite, call_event_count: 10, active_channels: ["phone"],
});

beforeEach(() => { rows = []; err = null; });

describe("useCoverageSnapshots", () => {
  it("returns the newest snapshot as latest and the series in chronological order", async () => {
    rows = [snap("2026-06-24", 0.8), snap("2026-06-23", 0.5)]; // query returns newest-first
    const { result } = renderHook(() => useCoverageSnapshots(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.latest).not.toBeNull());
    expect(result.current.latest?.snapshotDate).toBe("2026-06-24");
    expect(result.current.latest?.compositeCoverage).toBe(0.8);
    expect(result.current.series.map((s) => s.snapshotDate)).toEqual(["2026-06-23", "2026-06-24"]);
    // the newest-first derivation rests on the descending order — pin it
    expect(orderSpy).toHaveBeenCalledWith("snapshot_date", { ascending: false });
  });

  it("treats a query error as no-data (no throw to the widget)", async () => {
    err = new Error("rls denied");
    const { result } = renderHook(() => useCoverageSnapshots(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.latest).toBeNull();
    expect(result.current.series).toEqual([]);
  });

  it("returns null latest + empty series when there are no snapshots", async () => {
    rows = [];
    const { result } = renderHook(() => useCoverageSnapshots(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.latest).toBeNull();
    expect(result.current.series).toEqual([]);
  });
});
