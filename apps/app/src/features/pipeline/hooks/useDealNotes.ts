import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface DealNote { id: string; dealId: string; body: string; createdBy: string; createdAt: string; }
interface DealNoteRow { id: string; deal_id: string; body: string; created_by: string; created_at: string; }
const toNote = (r: DealNoteRow): DealNote => ({ id: r.id, dealId: r.deal_id, body: r.body, createdBy: r.created_by, createdAt: r.created_at });
export const DEAL_NOTES_KEY = (dealId: string) => ["deal-notes", dealId] as const;

export function useDealNotes(dealId: string) {
  return useQuery({
    queryKey: DEAL_NOTES_KEY(dealId),
    queryFn: async (): Promise<DealNote[]> => {
      const { data, error } = await supabase.from("deal_notes").select("*").eq("deal_id", dealId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data as DealNoteRow[]).map(toNote);
    },
    enabled: !!dealId,
  });
}
export function useCreateDealNote() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ dealId, body }: { dealId: string; body: string }) => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.from("deal_notes").insert({ deal_id: dealId, created_by: userId, body }).select("id").single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: DEAL_NOTES_KEY(v.dealId) }); },
  });
}
export function useDeleteDealNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; dealId: string }) => {
      const { error } = await supabase.from("deal_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: DEAL_NOTES_KEY(v.dealId) }); },
  });
}
