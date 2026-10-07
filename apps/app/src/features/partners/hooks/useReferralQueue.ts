/**
 * useReferralQueue: inbound referrals waiting for triage (status submitted)
 * that the signed-in user can see. RLS does the scoping: a rep sees their own,
 * a manager their team's, an administrator everything including the
 * administrator queue. Oldest first so nothing sits at the bottom.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface QueueReferral {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerCompany: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  placeId: string | null;
  notes: string;
  submittedAt: string;
  assignedUserId: string | null;
}

interface QueueRow {
  id: string;
  partner_id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  place_id: string | null;
  notes: string;
  submitted_at: string;
  assigned_user_id: string | null;
  partner: { name: string; company: string } | null;
}

export const REFERRAL_QUEUE_QUERY_KEY = (userId: string | undefined) =>
  ["referrals", "queue", userId ?? "anon"] as const;

export function useReferralQueue() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: REFERRAL_QUEUE_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<QueueReferral[]> => {
      const { data, error } = await supabase
        .from("referrals")
        .select(
          "id, partner_id, company_name, contact_name, contact_email, contact_phone, " +
            "address, place_id, notes, submitted_at, assigned_user_id, " +
            "partner:partners(name, company)",
        )
        .eq("status", "submitted")
        .eq("direction", "inbound")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as QueueRow[]).map((r) => ({
        id: r.id,
        partnerId: r.partner_id,
        partnerName: r.partner?.name ?? "",
        partnerCompany: r.partner?.company ?? "",
        companyName: r.company_name,
        contactName: r.contact_name,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        address: r.address,
        placeId: r.place_id,
        notes: r.notes,
        submittedAt: r.submitted_at,
        assignedUserId: r.assigned_user_id,
      }));
    },
    staleTime: 30_000,
  });
}
