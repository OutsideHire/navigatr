/**
 * useUpdateOrgProfession — admin-only setter for organizations.profession.
 *
 * Pass null to clear (fall back to per-user profession). On success the
 * org-profession query is invalidated so every component reading useTerm /
 * useFieldVisible refreshes in place.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ORG_PROFESSION_QUERY_KEY } from "./useOrgProfession";
import { useProfile } from "@/features/auth/useProfile";
import type { Profession } from "./terminology";

export function useUpdateOrgProfession() {
  const qc = useQueryClient();
  const profile = useProfile();
  const orgId = profile.data?.org_id;

  return useMutation<Profession | null, Error, Profession | null>({
    mutationFn: async (next) => {
      const { data, error } = await supabase.rpc("update_org_profession", {
        p_profession: next,
      });
      if (error) throw new Error(error.message);
      // RPC returns the new value (null when cleared). Type-narrow so the
      // returned type matches what consumers expect.
      return (data as Profession | null) ?? null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ORG_PROFESSION_QUERY_KEY(orgId) });
    },
  });
}
