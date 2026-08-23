/**
 * useActivityGeostampSetting — read/write the per-user "record my location when
 * I log an activity" consent (PRD 6.12.A Bundle 5, FR-HIER-32).
 *
 * Stored in user_location_settings (self-only RLS). A missing row means ENABLED
 * (the PRD default / opt-out), so we only persist an explicit choice. The write
 * upserts on user_id.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";

export const GEOSTAMP_SETTING_QUERY_KEY = (userId: string | undefined) =>
  ["location-settings", "geostamp", userId ?? "anon"] as const;

/** Current value; defaults to true (enabled) when no row exists or while loading. */
export function useActivityGeostampSetting() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: GEOSTAMP_SETTING_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("user_location_settings")
        .select("activity_geostamp_enabled")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data?.activity_geostamp_enabled ?? true;
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateActivityGeostampSetting() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const orgId = useProfile().data?.org_id;
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<boolean> => {
      if (!userId) throw new Error("Not signed in");
      if (!orgId) throw new Error("Profile not loaded");
      const { error } = await supabase
        .from("user_location_settings")
        .upsert(
          {
            user_id: userId,
            org_id: orgId,
            activity_geostamp_enabled: enabled,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (error) throw error;
      return enabled;
    },
    onSuccess: (enabled) => {
      queryClient.setQueryData(GEOSTAMP_SETTING_QUERY_KEY(userId), enabled);
    },
  });
}
