/**
 * useOrgSuspended — reads the caller's organization `is_disabled` flag.
 *
 * `organizations.is_disabled` is Navigatr's commercial kill switch. It is set
 * by the Navigatr operator directly in Supabase Studio (service-role); there is
 * no in-app setter, and no ISO user (not even an org administrator) can flip it.
 *
 * The value is server-authoritative: the `organizations_select` RLS policy
 * exposes only the caller's OWN org row, so the client cannot spoof
 * is_disabled=false. ProtectedRoute uses this to hard-block a suspended org's
 * users out of every authenticated surface.
 *
 * Cache key tail = userId + orgId for clean sign-out / org-switch invalidation.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "./useProfile";

export const ORG_SUSPENDED_QUERY_KEY = (
  userId: string | undefined,
  orgId: string | undefined,
) => ["org-suspended", userId ?? "anon", orgId ?? "none"] as const;

export function useOrgSuspended() {
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const orgId = profile.data?.org_id;

  return useQuery({
    queryKey: ORG_SUSPENDED_QUERY_KEY(userId, orgId),
    enabled: Boolean(userId && orgId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("is_disabled")
        .eq("id", orgId!)
        .single();
      if (error) throw error;
      return Boolean((data as { is_disabled: boolean }).is_disabled);
    },
    // Suspension is rare and operator-driven, but a live session must notice a
    // fresh suspend within a bounded window. staleTime keeps mounts/refocus
    // cheap; refetchInterval guarantees an upper bound even for a session that
    // stays on one focused route all day and never triggers a mount/focus
    // refetch. (Default refetchIntervalInBackground=false, so a hidden tab does
    // not poll but still re-checks on refocus.)
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchInterval: 3 * 60_000,
  });
}
