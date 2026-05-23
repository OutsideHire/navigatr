// Covers RPC payload shape, window-day pass-through, and auth refusal.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useTeamLeaderboard } from "./useTeamLeaderboard";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  authUserId = "user-1";
});

const SAMPLE_ROW = {
  agent_id: "a1",
  full_name: "Alice",
  email: "alice@x.com",
  role: "rep" as const,
  status: "active" as const,
  open_deals: 3,
  pipeline_cents: 150_000,
  won_deals_window: 1,
  won_cents_window: 50_000,
  lost_deals_window: 0,
  lost_cents_window: 0,
  activities_window: 12,
  last_activity: "2026-05-20T10:00:00Z",
};

describe("useTeamLeaderboard", () => {
  it("calls team_leaderboard RPC with p_window_days: 30 (default) and returns data", async () => {
    rpcMock.mockResolvedValueOnce({ data: [SAMPLE_ROW], error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useTeamLeaderboard(), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("team_leaderboard", { p_window_days: 30 });
    expect(result.current.data).toEqual([SAMPLE_ROW]);
  });

  it("passes different window days (7, 90) through to the RPC", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const client7 = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result: r7 } = renderHook(() => useTeamLeaderboard(7), {
      wrapper: makeWrapper(client7),
    });
    await waitFor(() => expect(r7.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("team_leaderboard", { p_window_days: 7 });

    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: [], error: null });

    const client90 = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result: r90 } = renderHook(() => useTeamLeaderboard(90), {
      wrapper: makeWrapper(client90),
    });
    await waitFor(() => expect(r90.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("team_leaderboard", { p_window_days: 90 });
  });

  it("does not call RPC when not signed in (query disabled)", () => {
    authUserId = undefined;
    rpcMock.mockResolvedValue({ data: [], error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useTeamLeaderboard(), {
      wrapper: makeWrapper(client),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.status).toBe("pending");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
