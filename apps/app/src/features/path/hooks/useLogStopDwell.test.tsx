import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLogStopDwell } from "./useLogStopDwell";

const insert = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ insert }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => { insert.mockReset(); });

describe("useLogStopDwell", () => {
  it("inserts a row with computed dwell_minutes, stop_type, deal_id, and user_id", async () => {
    insert.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useLogStopDwell(), { wrapper: wrap(makeClient()) });
    await result.current.logStopDwell({
      stopType: "appointment",
      dealId: "deal-1",
      arrivedAt: "2026-08-11T15:00:00.000Z",
      closedAt: "2026-08-11T15:18:00.000Z",
    });
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      stop_type: "appointment",
      deal_id: "deal-1",
      arrived_at: "2026-08-11T15:00:00.000Z",
      closed_at: "2026-08-11T15:18:00.000Z",
      dwell_minutes: 18,
    });
  });

  it("passes a null deal_id through for a discovery stop", async () => {
    insert.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useLogStopDwell(), { wrapper: wrap(makeClient()) });
    await result.current.logStopDwell({
      stopType: "discovery",
      dealId: null,
      arrivedAt: "2026-08-11T15:00:00.000Z",
      closedAt: "2026-08-11T15:07:30.000Z",
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ stop_type: "discovery", deal_id: null, dwell_minutes: 7.5 }),
    );
  });

  it("swallows a supabase insert error without throwing", async () => {
    insert.mockResolvedValueOnce({ error: { message: "relation does not exist" } });
    const { result } = renderHook(() => useLogStopDwell(), { wrapper: wrap(makeClient()) });
    await expect(
      result.current.logStopDwell({
        stopType: "discovery",
        dealId: null,
        arrivedAt: "2026-08-11T15:00:00.000Z",
        closedAt: "2026-08-11T15:10:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows a thrown/rejected insert without throwing", async () => {
    insert.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useLogStopDwell(), { wrapper: wrap(makeClient()) });
    await expect(
      result.current.logStopDwell({
        stopType: "appointment",
        dealId: "deal-1",
        arrivedAt: "2026-08-11T15:00:00.000Z",
        closedAt: "2026-08-11T15:30:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});
