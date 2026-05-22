/**
 * useSeatUsage — current seat usage for the caller's org.
 *
 * Returns { used, limit, remaining }. `limit` is null when the org has
 * no cap. UI renders the percent + "1,247 / 1,500" indicator from this.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface SeatUsage {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export function useSeatUsage() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: ["admin", "seat-usage", userId ?? "anon"],
    enabled: Boolean(userId),
    queryFn: async (): Promise<SeatUsage> => {
      // Profiles head count (RLS scopes to org). Exclude deactivated.
      const { count: pCount, error: pErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .is("deactivated_at", null);
      if (pErr) throw pErr;

      const { count: iCount, error: iErr } = await supabase
        .from("org_invites")
        .select("id", { count: "exact", head: true })
        .is("accepted_at", null)
        .is("revoked_at", null);
      if (iErr) throw iErr;

      const { data: org, error: oErr } = await supabase
        .from("organizations")
        .select("seat_limit")
        .single();
      if (oErr) throw oErr;

      const used = (pCount ?? 0) + (iCount ?? 0);
      const limit = (org?.seat_limit as number | null) ?? null;
      return {
        used,
        limit,
        remaining: limit === null ? null : limit - used,
      };
    },
    staleTime: 30_000,
  });
}
