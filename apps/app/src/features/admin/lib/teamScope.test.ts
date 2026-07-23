import { describe, it, expect } from "vitest";
import { hasNoReports } from "./teamScope";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

function row(agent_id: string, status: LeaderboardRow["status"]): LeaderboardRow {
  return { agent_id, status } as LeaderboardRow;
}

describe("hasNoReports", () => {
  it("is true when the only active member is the current user", () => {
    expect(hasNoReports([row("me", "active")], "me")).toBe(true);
  });
  it("is true when the user is alone even with pending invites present", () => {
    expect(hasNoReports([row("me", "active"), row("inv", "invited")], "me")).toBe(true);
  });
  it("is false when another active member exists", () => {
    expect(hasNoReports([row("me", "active"), row("rep", "active")], "me")).toBe(false);
  });
  it("is false when there are no rows at all (nothing loaded yet)", () => {
    expect(hasNoReports([], "me")).toBe(false);
  });
  it("is false when the current user id is unknown", () => {
    expect(hasNoReports([row("me", "active")], undefined)).toBe(false);
  });
});
