import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUnloggedDials } from "./useUnloggedDials";

const HOUR = 60 * 60 * 1000;
const oldDial = new Date(Date.now() - 6 * HOUR).toISOString();

const dialRows = [{ deal_id: "d1", detected_at: oldDial }];
const callRows: Array<{ deal_id: string; occurred_at: string }> = [];
function builder(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "order"]) b[m] = vi.fn(() => b);
  b.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null });
  return b;
}
vi.mock("@/lib/supabase", () => ({
  supabase: { from: (t: string) => builder(t === "coverage_signal" ? dialRows : callRows) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: [{ id: "d1", companyName: "Acme Co" }], isSuccess: true }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => { callRows.length = 0; });

describe("useUnloggedDials", () => {
  it("returns unmatched dials joined with the deal company name", async () => {
    const { result } = renderHook(() => useUnloggedDials(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { dealId: "d1", companyName: "Acme Co", lastDetectedAt: oldDial, dialCount: 1 },
    ]);
  });

  it("returns empty when there are no dials", async () => {
    dialRows.length = 0;
    const { result } = renderHook(() => useUnloggedDials(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    dialRows.push({ deal_id: "d1", detected_at: oldDial }); // restore for other tests
  });

  it("suppresses a dial that the fetched Call activities match (calls are wired in)", async () => {
    // A Call activity 1h after the 6h-old dial → within the 4h grace → matched.
    callRows.push({ deal_id: "d1", occurred_at: new Date(Date.now() - 5 * HOUR).toISOString() });
    const { result } = renderHook(() => useUnloggedDials(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
