/**
 * useProfile — fetches the current user's `profiles` row from Supabase.
 *
 * The profile is what proves a user is "fully set up" in the org sense:
 * org_id + role exist. Without it, every RLS-gated query returns empty
 * sets. RequireProfile uses this hook to gate access; AuthCallback waits
 * for it to populate after calling claim_invite_code.
 *
 * Keyed by user id so a sign-out + new sign-in invalidates cleanly.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { RoleLevel } from "./capabilities";

export interface Profile {
  id: string;
  org_id: string;
  role: "rep" | "manager" | "admin";
  role_level: RoleLevel;
  view_as_enabled: boolean;
  full_name: string | null;
  created_at: string;
  primary_calendar_provider: "google" | "microsoft" | null;
}

export function useProfile() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: ["profile", userId ?? "anon"],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, org_id, role, role_level, view_as_enabled, full_name, created_at, primary_calendar_provider")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as Profile | null) ?? null;
    },
    // 5-minute staleTime stops every new consumer mount from kicking off a
    // background refetch (which flips ProtectedRoute's `isFetching` gate
    // back to true and re-spinners the route). After claim_invite_code the
    // callback explicitly fetchQuery's the profile, so we don't need
    // staleTime: 0 to "see" a freshly-created profile.
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
