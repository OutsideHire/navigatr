import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface DealContact {
  id: string; dealId: string; name: string;
  title: string | null; email: string | null; phone: string | null;
  role: string | null; note: string | null; createdAt: string;
}
interface DealContactRow {
  id: string; deal_id: string; name: string;
  title: string | null; email: string | null; phone: string | null;
  role: string | null; note: string | null; created_at: string;
}
function toContact(r: DealContactRow): DealContact {
  return { id: r.id, dealId: r.deal_id, name: r.name, title: r.title, email: r.email, phone: r.phone, role: r.role, note: r.note, createdAt: r.created_at };
}
export const DEAL_CONTACTS_KEY = (dealId: string) => ["deal-contacts", dealId] as const;

export function useDealContacts(dealId: string) {
  return useQuery({
    queryKey: DEAL_CONTACTS_KEY(dealId),
    queryFn: async (): Promise<DealContact[]> => {
      const { data, error } = await supabase
        .from("deal_contacts").select("*").eq("deal_id", dealId).order("created_at", { ascending: true });
      if (error) throw error;
      return (data as DealContactRow[]).map(toContact);
    },
    enabled: !!dealId,
  });
}

export interface DealContactInput { name: string; title?: string; email?: string; phone?: string; role?: string; note?: string; }

export function useCreateDealContact() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ dealId, ...input }: DealContactInput & { dealId: string }) => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.from("deal_contacts").insert({
        deal_id: dealId, created_by: userId,
        name: input.name, title: input.title || null, email: input.email || null,
        phone: input.phone || null, role: input.role || null, note: input.note || null,
      }).select("id").single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: (_r, vars) => { void qc.invalidateQueries({ queryKey: DEAL_CONTACTS_KEY(vars.dealId) }); },
  });
}

export function useUpdateDealContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; dealId: string; patch: Partial<DealContactInput> }) => {
      const { error } = await supabase.from("deal_contacts").update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.title !== undefined ? { title: patch.title || null } : {}),
        ...(patch.email !== undefined ? { email: patch.email || null } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone || null } : {}),
        ...(patch.role !== undefined ? { role: patch.role || null } : {}),
        ...(patch.note !== undefined ? { note: patch.note || null } : {}),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => { void qc.invalidateQueries({ queryKey: DEAL_CONTACTS_KEY(vars.dealId) }); },
  });
}

export function useDeleteDealContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; dealId: string }) => {
      const { error } = await supabase.from("deal_contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => { void qc.invalidateQueries({ queryKey: DEAL_CONTACTS_KEY(vars.dealId) }); },
  });
}
