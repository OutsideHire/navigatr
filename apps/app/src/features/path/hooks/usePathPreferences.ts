/**
 * usePathPreferences — the rep's saved default industry selection (server-backed,
 * owner-scoped via RLS). Falls back to RECOMMENDED_SELECTION when there's no row
 * or an empty set. useUpdateDefaultIndustries upserts the one-row-per-rep preference.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { RECOMMENDED_SELECTION, selectedCategories, pruneToKnownCategories, type IndustrySelection } from "../lib/industrySelection";

export const PATH_PREFS_QUERY_KEY = ["path", "preferences"] as const;

export function usePathPreferences() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...PATH_PREFS_QUERY_KEY, userId],
    enabled: !!userId,
    queryFn: async (): Promise<IndustrySelection> => {
      const { data, error } = await (supabase
        .from("path_preferences")
        .select("default_industries")
        .maybeSingle() as unknown as Promise<{ data: { default_industries: IndustrySelection } | null; error: { message: string } | null }>);
      if (error) throw error;
      const saved = pruneToKnownCategories((data?.default_industries ?? {}) as IndustrySelection);
      return selectedCategories(saved).length > 0 ? saved : RECOMMENDED_SELECTION;
    },
  });
}

export function useUpdateDefaultIndustries() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (selection: IndustrySelection): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await (supabase
        .from("path_preferences")
        .upsert(
          { user_id: userId, default_industries: selection, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        )
        .select()
        .single() as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PATH_PREFS_QUERY_KEY, userId] }),
  });
}
