/**
 * useDemoResetEnabled — reads the org's `demo_reset` feature flag from
 * `org_features` (RLS: any org member can read their org's flags). Gates
 * the "Demo tools" card in Settings; the reset_demo_data RPC itself is
 * still enforced server-side (flag + admin role).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";

export function useDemoResetEnabled(): boolean {
  const userId = useAuth((s) => s.user?.id);
  const orgId = useProfile().data?.org_id;
  const q = useQuery({
    queryKey: ["org-feature", "demo_reset", orgId ?? "none"],
    enabled: Boolean(userId && orgId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("org_features")
        .select("enabled")
        .eq("org_id", orgId!)
        .eq("feature_key", "demo_reset")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean((data as { enabled: boolean } | null)?.enabled);
    },
  });
  return q.data === true;
}
