/**
 * useRecordDial — writes one phone/dial coverage_signal per click-to-call tap.
 *
 * Best-effort + fire-and-forget: callers use `mutate` (not mutateAsync) and
 * never await it, so a failed insert never blocks the tel: launch. With no
 * session/profile the insert is skipped silently. RLS with-check enforces
 * org_id = user_org_id() and user_id = auth.uid(); the org-consistency
 * trigger overwrites org_id from the deal server-side.
 */

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";

export interface RecordDialInput {
  dealId: string;
  phoneNumber: string;
}

export function useRecordDial() {
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: RecordDialInput): Promise<void> => {
      // Best-effort: no session/profile → skip silently (don't block the call).
      if (!userId || !profile.data?.org_id) return;
      const { error } = await supabase.from("coverage_signal").insert({
        org_id: profile.data.org_id,
        user_id: userId,
        channel: "phone",
        signal_type: "dial",
        deal_id: input.dealId,
        source_metadata: { phone_number: input.phoneNumber },
      });
      if (error) throw error;
    },
  });
}
