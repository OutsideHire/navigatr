/**
 * useViewerScope — resolves the current viewer's default scope for the
 * Pipeline/Partners scope line and metric tags (PRD 6.12.A Bundle 3).
 *
 * Scope level comes from the viewer's role_level (useProfile) plus whether they
 * have any active report in their reporting subtree. The subtree roster is the
 * team_leaderboard RPC, already scoped server-side to the caller's subtree (a
 * rep with no reports gets back only their own row), so "has reports" is simply
 * "an active member other than me is present". The roster is also what Slice 2's
 * seller filter is built from, hence it is surfaced here now.
 */

import * as React from "react";
import { useProfile } from "@/features/auth/useProfile";
import { useAuth } from "@/stores/auth";
import { useTeamLeaderboard } from "@/features/admin/hooks/useTeamLeaderboard";
import { resolveScopeLevel, type ScopeLevel } from "./scope";

export interface Seller {
  id: string;
  name: string;
}

export interface ViewerScope {
  scopeLevel: ScopeLevel;
  hasReports: boolean;
  /** Active members of the viewer's subtree (including the viewer), for the
   *  Slice 2 seller filter. Sorted by name. */
  sellers: Seller[];
  /** The viewer's own display name, for rendering their avatar on "You" cards. */
  viewerName: string | null;
}

export function useViewerScope(): ViewerScope {
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const leaderboard = useTeamLeaderboard();

  return React.useMemo(() => {
    const rows = leaderboard.data ?? [];
    const active = rows.filter((r) => r.status === "active");
    const hasReports = active.some((r) => r.agent_id !== userId);
    const sellers: Seller[] = active
      .map((r) => ({ id: r.agent_id, name: r.full_name ?? r.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      scopeLevel: resolveScopeLevel(profile.data?.role_level ?? null, hasReports),
      hasReports,
      sellers,
      viewerName: profile.data?.full_name ?? null,
    };
  }, [leaderboard.data, profile.data?.role_level, profile.data?.full_name, userId]);
}
