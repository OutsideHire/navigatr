import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAppointmentsAwaitingOutcome } from "./useAppointmentsAwaitingOutcome";

const HOUR = 60 * 60 * 1000;
const pastEnd = new Date(Date.now() - 2 * HOUR).toISOString();
const pastStart = new Date(Date.now() - 3 * HOUR).toISOString();

let rows: Array<{
  id: string;
  deal_id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  outcome: string | null;
}>;

function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) b[m] = vi.fn(() => b);
  b.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null });
  return b;
}
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => builder() },
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

beforeEach(() => {
  rows = [
    {
      id: "a1",
      deal_id: "d1",
      title: "Site visit",
      start_at: pastStart,
      end_at: pastEnd,
      status: "scheduled",
      outcome: null,
    },
  ];
});

describe("useAppointmentsAwaitingOutcome", () => {
  it("returns past-due unlogged appointments joined with the deal company name", async () => {
    const { result } = renderHook(() => useAppointmentsAwaitingOutcome(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: "a1",
        dealId: "d1",
        companyName: "Acme Co",
        title: "Site visit",
        startAt: pastStart,
        endAt: pastEnd,
        hasFutureAppointment: false,
      },
    ]);
  });

  it("returns empty when there are no scheduled appointments", async () => {
    rows = [];
    const { result } = renderHook(() => useAppointmentsAwaitingOutcome(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("marks hasFutureAppointment true when the same deal has another scheduled appointment ahead of now", async () => {
    rows.push({
      id: "a2",
      deal_id: "d1",
      title: "Follow-up visit",
      start_at: new Date(Date.now() + 1 * HOUR).toISOString(),
      end_at: new Date(Date.now() + 2 * HOUR).toISOString(),
      status: "scheduled",
      outcome: null,
    });
    const { result } = renderHook(() => useAppointmentsAwaitingOutcome(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: "a1",
        dealId: "d1",
        companyName: "Acme Co",
        title: "Site visit",
        startAt: pastStart,
        endAt: pastEnd,
        hasFutureAppointment: true,
      },
    ]);
  });
});
