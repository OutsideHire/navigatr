/**
 * useOrgMemberNames — id→display-name map for the profiles the viewer can see
 * (RLS-scoped, so a manager gets their subtree). Used to label per-rep KPI
 * breakdown rows. Name = full_name, falling back to email.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

interface MemberRow {
  id: string;
  full_name: string | null;
  email: string;
}

export function useOrgMemberNames(enabled = true): Map<string, string> {
  const userId = useAuth((s) => s.user?.id);
  const q = useQuery({
    queryKey: ["orgMemberNames", userId ?? "anon"],
    // Only fetch when a consumer needs it (managers/admins). Reps never render
    // the breakdown, so we skip the profiles query for them.
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return (data ?? []) as MemberRow[];
    },
    staleTime: 5 * 60_000,
  });

  return React.useMemo(() => {
    const m = new Map<string, string>();
    for (const r of q.data ?? []) m.set(r.id, r.full_name ?? r.email);
    return m;
  }, [q.data]);
}
