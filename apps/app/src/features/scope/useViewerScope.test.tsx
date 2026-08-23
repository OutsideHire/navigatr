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
vi.mock("@/features/admin/hooks/useTeamLeaderboard", () => ({
  useTeamLeaderboard: () => ({ data: leaderboard }),
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
});

describe("useViewerScope", () => {
  it("resolves 'you' for a solo rep (only their own leaderboard row)", () => {
    leaderboard = [row({ agent_id: "me", full_name: "Me Rep" })];
    const { result } = renderHook(() => useViewerScope());
    expect(result.current.scopeLevel).toBe("you");
    expect(result.current.hasReports).toBe(false);
    expect(result.current.viewerName).toBe("Me Rep");
  });

  it("resolves 'team' when an active report other than the viewer is present", () => {
    profile = { role_level: "sales_manager", full_name: "Boss" };
    leaderboard = [
      row({ agent_id: "me" }),
      row({ agent_id: "r1", full_name: "Rep One", status: "active" }),
    ];
    const { result } = renderHook(() => useViewerScope());
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
