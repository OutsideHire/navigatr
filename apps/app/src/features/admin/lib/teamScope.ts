/**
 * Team page scoping helpers. `team_leaderboard` is scoped server-side to the
 * caller's reporting subtree, so a manager with no reports gets back only their
 * own row. This detects that "solo" case to show a "no reports yet" hint
 * instead of an org chart of one.
 */
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

/**
 * True when the current user is the only ACTIVE member in the returned rows
 * (pending invites do not count as reports). False when rows are empty (data
 * not loaded) or the current user id is unknown.
 */
export function hasNoReports(rows: LeaderboardRow[], currentUserId: string | undefined): boolean {
  if (!currentUserId || rows.length === 0) return false;
  const otherActive = rows.some((r) => r.status === "active" && r.agent_id !== currentUserId);
  const selfPresent = rows.some((r) => r.agent_id === currentUserId);
  return selfPresent && !otherActive;
}
