/**
 * useLogPartnerTouch — write a new touch against a partner.
 *
 * On success: invalidate the per-partner timeline AND the partners
 * list (the sync trigger updates partners.last_touch_at +
 * next_followup_at, which the list page renders).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { PARTNER_ACTIVITIES_QUERY_KEY, type PartnerTouchType } from "./usePartnerActivities";
import { PARTNERS_QUERY_KEY } from "./usePartners";

export interface LogPartnerTouchInput {
  partnerId: string;
  type: PartnerTouchType;
  notes?: string;
  durationMinutes?: number | null;
  occurredAt?: string;
  /** ISO timestamp from a date picker; converted to DATE here. */
  followUpDate?: string | null;
}

export function useLogPartnerTouch() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: LogPartnerTouchInput): Promise<{ id: string }> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) {
        throw new Error("Profile not loaded — cannot log touch");
      }

      // follow_up_date is a DATE column; strip the time portion.
      const followUpDateOnly = input.followUpDate
        ? input.followUpDate.slice(0, 10)
        : null;

      const { data, error } = await supabase
        .from("partner_activities")
        .insert({
          org_id:           profile.data.org_id,
          partner_id:       input.partnerId,
          logged_by:        userId,
          type:             input.type,
          notes:            input.notes ?? "",
          duration_minutes: input.durationMinutes ?? null,
          occurred_at:      input.occurredAt ?? new Date().toISOString(),
          follow_up_date:   followUpDateOnly,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: (_data, variables) => {
      // Per-partner timeline — the partner detail page reads this.
      void queryClient.invalidateQueries({
        queryKey: PARTNER_ACTIVITIES_QUERY_KEY(userId, variables.partnerId),
      });
      // Partners list — the sync trigger updated last_touch_at +
      // next_followup_at. Both columns render on the list page.
      void queryClient.invalidateQueries({
        queryKey: PARTNERS_QUERY_KEY(userId),
      });
    },
  });
}
