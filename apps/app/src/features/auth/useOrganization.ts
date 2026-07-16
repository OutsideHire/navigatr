/**
 * useOrganization — read the current user's organization row.
 *
 * Pulls id + name + invite_code from `organizations`. RLS allows the
 * select via the org_id matching the user's own profile. The invite
 * code powers the Settings → Team share-link card.
 *
 * Cache key tail = userId for clean sign-out invalidation.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "./useProfile";

export interface Organization {
  id: string;
  name: string;
  inviteCode: string;
  /** Activity-to-Win value-band thresholds (cents); null = use app defaults. */
  valueBandLowCents: number | null;
  valueBandHighCents: number | null;
}

interface OrgRow {
  id: string;
  name: string;
  invite_code: string;
  aw_value_band_low_cents: number | null;
  aw_value_band_high_cents: number | null;
}

export const ORGANIZATION_QUERY_KEY = (userId: string | undefined, orgId: string | undefined) =>
  ["organization", userId ?? "anon", orgId ?? "none"] as const;

export function useOrganization() {
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const orgId = profile.data?.org_id;

  return useQuery({
    queryKey: ORGANIZATION_QUERY_KEY(userId, orgId),
    enabled: Boolean(userId && orgId),
    queryFn: async (): Promise<Organization> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, invite_code, aw_value_band_low_cents, aw_value_band_high_cents")
        .eq("id", orgId!)
        .single();
      if (error) throw error;
      const row = data as unknown as OrgRow;
      return {
        id: row.id,
        name: row.name,
        inviteCode: row.invite_code,
        valueBandLowCents: row.aw_value_band_low_cents ?? null,
        valueBandHighCents: row.aw_value_band_high_cents ?? null,
      };
    },
    // The invite_code rotates rarely (admin action). Long staleTime to
    // avoid refetches on every consumer mount.
    staleTime: 5 * 60_000,
  });
}
