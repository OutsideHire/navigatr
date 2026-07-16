/**
 * useUpdateOrgValueBands — set (or reset) the org's Activity-to-Win deal-value
 * thresholds via the update_org_value_bands RPC (admin/manager-only, enforced
 * server-side). Pass null/null to reset to the app defaults. Invalidates the
 * organization query so the AW report's band dropdown updates. Mirrors
 * useRotateInviteCode.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ValueBandInput {
  /** Lower threshold in cents, or null (with highCents null) to reset. */
  lowCents: number | null;
  highCents: number | null;
}

export function useUpdateOrgValueBands() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ lowCents, highCents }: ValueBandInput): Promise<void> => {
      const { error } = await supabase.rpc("update_org_value_bands", {
        p_low_cents: lowCents,
        p_high_cents: highCents,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // Prefix-match: refreshes useOrganization regardless of the userId/orgId tail.
      void queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });
}
