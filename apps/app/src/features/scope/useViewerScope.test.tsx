import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { LeaderboardRow } from "@/features/admin/hooks/useTeamLeaderboard";
import { useViewerScope } from "./useViewerScope";

let leaderboard: LeaderboardRow[] = [];
let profile: { role_level: string | null; full_name: string | null } | null = null;
const authUserId = "me";

vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: authUserId } }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: profile }),
}));
const teamLeaderboardMock = vi.fn();
vi.mock("@/features/admin/hooks/useTeamLeaderboard", () => ({
  // Mirror the real hook's gating: when the caller passes { enabled: false },
  // the query is disabled and returns no data.
  useTeamLeaderboard: (windowDays?: number, options?: { enabled?: boolean }) => {
    teamLeaderboardMock(windowDays, options);
    const enabled = options?.enabled ?? true;
    return { data: enabled ? leaderboard : undefined };
  },
}));

function row(over: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    agent_id: "x", full_name: "X", email: "x@e.co", role: "rep", role_level: "sales_professional",
    status: "active", manager_id: null, open_deals: 0, pipeline_cents: 0, won_deals_window: 0,
    won_cents_window: 0, lost_deals_window: 0, lost_cents_window: 0, activities_window: 0,
    last_activity: null, ...over,
  };
}

beforeEach(() => {
  leaderboard = [];
  profile = { role_level: "sales_professional", full_name: "Me Rep" };
  teamLeaderboardMock.mockClear();
});

describe("useViewerScope", () => {
  it("resolves 'you' for a rep WITHOUT calling the manager-only roster RPC (NAVIGATR-APP-7 gate)", () => {
    // A rep would get P0001 forbidden from team_leaderboard, so it must not fire.
    profile = { role_level: "sales_professional", full_name: "Me Rep" };
    const { result } = renderHook(() => useViewerScope());
    expect(result.current.scopeLevel).toBe("you");
    expect(result.current.hasReports).toBe(false);
    expect(result.current.sellers).toEqual([]);
    expect(result.current.viewerName).toBe("Me Rep");
    expect(teamLeaderboardMock).toHaveBeenCalledWith(30, { enabled: false });
  });

  it("resolves 'team' when an active report other than the viewer is present (manager: roster enabled)", () => {
    profile = { role_level: "sales_manager", full_name: "Boss" };
    leaderboard = [
      row({ agent_id: "me" }),
      row({ agent_id: "r1", full_name: "Rep One", status: "active" }),
    ];
    const { result } = renderHook(() => useViewerScope());
    expect(teamLeaderboardMock).toHaveBeenCalledWith(30, { enabled: true });
    expect(result.current.hasReports).toBe(true);
    expect(result.current.scopeLevel).toBe("team");
    expect(result.current.sellers.map((s) => s.name)).toContain("Rep One");
  });

  it("resolves 'org' for an administrator regardless of reports", () => {
    profile = { role_level: "administrator", full_name: "Admin" };
    leaderboard = [row({ agent_id: "me" })];
    const { result } = renderHook(() => useViewerScope());
    expect(result.current.scopeLevel).toBe("org");
  });

  it("excludes non-active members from the seller roster", () => {
    profile = { role_level: "sales_manager", full_name: "Boss" };
    leaderboard = [
      row({ agent_id: "me" }),
      row({ agent_id: "inv", full_name: "Invited", status: "invited" }),
    ];
    const { result } = renderHook(() => useViewerScope());
    expect(result.current.hasReports).toBe(false); // invited doesn't count
    expect(result.current.sellers.map((s) => s.id)).not.toContain("inv");
  });
});
