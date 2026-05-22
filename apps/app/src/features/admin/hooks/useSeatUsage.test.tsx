import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useSeatUsage } from "./useSeatUsage";

let counts: { profiles: number; invites: number };
let orgRow: { seat_limit: number | null };

function chain(table: string) {
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    is: () => obj,
    single: () => Promise.resolve({ data: orgRow, error: null }),
    then: (resolve: (r: { count: number; error: null }) => void) => {
      const c = table === "profiles" ? counts.profiles : counts.invites;
      resolve({ count: c, error: null });
    },
  };
  return obj;
}

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (t: string) => chain(t) },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: "u" } }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  counts = { profiles: 3, invites: 2 };
  orgRow = { seat_limit: 10 };
});

describe("useSeatUsage", () => {
  it("returns used/limit/remaining when limit is set", async () => {
    const { result } = renderHook(() => useSeatUsage(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ used: 5, limit: 10, remaining: 5 });
  });

  it("returns null remaining when limit is null (unlimited)", async () => {
    orgRow = { seat_limit: null };
    const { result } = renderHook(() => useSeatUsage(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ used: 5, limit: null, remaining: null });
  });
});
