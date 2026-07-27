import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAppointmentsAwaitingRollup } from "./useAppointmentsAwaitingRollup";

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
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={c}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rows = [];
  err = null;
  rpcMock.mockClear();
});

describe("useAppointmentsAwaitingRollup", () => {
  it("calls the appointments_awaiting_rollup RPC and maps rows to camelCase", async () => {
    rows = [{ user_id: "u1", full_name: "Alex", awaiting_count: 3 }];
    const { result } = renderHook(() => useAppointmentsAwaitingRollup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    expect(rpcMock).toHaveBeenCalledWith("appointments_awaiting_rollup");
    expect(result.current.rows[0]).toEqual({ userId: "u1", fullName: "Alex", awaitingCount: 3 });
  });

  it("returns [] on error", async () => {
    err = new Error("forbidden");
    const { result } = renderHook(() => useAppointmentsAwaitingRollup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows).toEqual([]);
  });
});
