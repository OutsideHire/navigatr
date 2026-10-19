/**
 * Notes partners wrote back on referrals sent to them (Partner Portal Phase
 * 2B-3, FR-PORT-78). A "Note from partner" record, never an activity. Read
 * under RLS (referral_partner_notes is visible when its referral is); only the
 * partner portal writes them.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PartnerNoteBack {
  id: string;
  body: string;
  createdAt: string;
}

export interface DealPartnerNotes {
  referralId: string;
  partnerId: string;
  /** Null when partners RLS hides the partner from this viewer. */
  partnerName: string | null;
  /** Newest first. */
  notes: PartnerNoteBack[];
}

interface NoteRow {
  id: string;
  body: string;
  created_at: string;
}

interface DealRow {
  id: string;
  partner_id: string;
  partner: { name: string } | null;
  notes: NoteRow[] | null;
}

interface CountRow {
  deal_id: string | null;
  notes: Array<{ id: string }> | null;
}

export function dealPartnerNotesKey(dealId: string) {
  return ["referrals", "partner-notes", "deal", dealId] as const;
}

export function partnerNoteCountsKey(partnerId: string) {
  return ["referrals", "partner-notes", "partner", partnerId] as const;
}

export function useDealPartnerNotes(dealId: string | undefined) {
  return useQuery({
    queryKey: dealPartnerNotesKey(dealId ?? "none"),
    enabled: Boolean(dealId),
    queryFn: async (): Promise<DealPartnerNotes[]> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, partner_id, partner:partners(name), notes:referral_partner_notes(id, body, created_at)")
        .eq("deal_id", dealId as string)
        .eq("direction", "outbound")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as DealRow[])
        .map((r) => ({
          referralId: r.id,
          partnerId: r.partner_id,
          partnerName: r.partner?.name ?? null,
          notes: (r.notes ?? [])
            .map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at }))
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
        }))
        .filter((g) => g.notes.length > 0);
    },
    staleTime: 30_000,
  });
}

export function usePartnerNoteCounts(partnerId: string | undefined) {
  return useQuery({
    queryKey: partnerNoteCountsKey(partnerId ?? "none"),
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("deal_id, notes:referral_partner_notes(id)")
        .eq("partner_id", partnerId as string)
        .eq("direction", "outbound")
        .limit(500);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of (data ?? []) as unknown as CountRow[]) {
        const n = r.notes?.length ?? 0;
        if (!r.deal_id || n === 0) continue;
        counts[r.deal_id] = (counts[r.deal_id] ?? 0) + n;
      }
      return counts;
    },
    staleTime: 30_000,
  });
}

export function partnerNoteCountLabel(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 note from partner" : `${n} notes from partner`;
}
