/**
 * Name and phone changes the partner made themselves in the portal
 * (FR-PORT-19). Read through RLS (visible when the partner is visible).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PartnerProfileChange {
  id: string;
  field: "name" | "phone";
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
}

interface Row {
  id: string;
  field: "name" | "phone";
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export function usePartnerProfileChanges(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["partners", "profile-changes", partnerId ?? "none"] as const,
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<PartnerProfileChange[]> => {
      const { data, error } = await supabase
        .from("partner_profile_changes")
        .select("id, field, old_value, new_value, changed_at")
        .eq("partner_id", partnerId as string)
        .order("changed_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        field: r.field,
        oldValue: r.old_value,
        newValue: r.new_value,
        changedAt: r.changed_at,
      }));
    },
    staleTime: 60_000,
  });
}
