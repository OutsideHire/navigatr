/**
 * useCreateOrganization — RPC mutation for self-serve org bootstrap.
 *
 * Used by /create-organization. On success, the caller's profile row
 * now exists; we refetch ["profile", userId] so ProtectedRoute lets
 * them through to /dashboard on the next navigation.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface CreateOrganizationResult {
  org_id: string;
  // The org creator is now seeded as the Administrator (L1) of the new org.
  role: "admin";
  invite_code: string;
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (name: string): Promise<CreateOrganizationResult> => {
      if (!userId) throw new Error("Not signed in");

      const { data, error } = await supabase.rpc("create_organization", {
        p_name: name,
      });
      // Supabase surfaces RPC failures as a PostgrestError plain object,
      // NOT a JS Error. Throwing it raw means CreateOrganizationPage's
      // `err instanceof Error` check fails and the user sees the generic
      // "Could not create workspace" instead of the real reason
      // (already_in_organization, org_name_too_short, etc.). Wrap it so
      // the actual message propagates — same as every other mutation hook.
      if (error) throw new Error(error.message);
      // The RPC returns a single-row table; supabase-js surfaces it as an
      // array. Pluck the first row and trust the schema.
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("create_organization returned no row");
      return row as CreateOrganizationResult;
    },
    onSuccess: () => {
      // The profile just appeared server-side. Invalidate so ProtectedRoute
      // refetches and lets the user through.
      void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
    },
  });
}
