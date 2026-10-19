/**
 * Public form submissions waiting for triage (FR-PORT-31) and the advice shown
 * while reviewing one. RLS on referral_form_submissions IS the triage rule (the
 * assignee and everyone above them; the administrator queue for administrators),
 * so every row returned is one the viewer may triage. Oldest first, like the
 * referral queue. submitter_ip is never selected (it is not granted).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface QueueSubmission {
  id: string;
  linkType: "user" | "tenant";
  assignedUserId: string | null;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  referredByText: string | null;
  referrerEmail: string | null;
  submittedAt: string;
}

interface SubmissionRow {
  id: string;
  link_type: "user" | "tenant";
  assigned_user_id: string | null;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  referred_by_text: string | null;
  referrer_email: string | null;
  submitted_at: string;
}

const COLUMNS =
  "id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone, " +
  "notes, referred_by_text, referrer_email, submitted_at";

export const FORM_SUBMISSION_QUEUE_QUERY_KEY = (userId: string | undefined) =>
  ["referrals", "form-submissions", userId ?? "anon"] as const;

export function useFormSubmissionQueue() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: FORM_SUBMISSION_QUEUE_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<QueueSubmission[]> => {
      const { data, error } = await supabase
        .from("referral_form_submissions")
        .select(COLUMNS)
        .is("triaged_at", null)
        .is("purged_at", null)
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as SubmissionRow[]).map((r) => ({
        id: r.id,
        linkType: r.link_type,
        assignedUserId: r.assigned_user_id,
        companyName: r.company_name,
        contactName: r.contact_name,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        notes: r.notes,
        referredByText: r.referred_by_text,
        referrerEmail: r.referrer_email,
        submittedAt: r.submitted_at,
      }));
    },
    staleTime: 30_000,
  });
}

export interface SubmissionAdvice {
  duplicateReferral: { id: string; companyName: string } | null;
  duplicateDeal: { id: string; companyName: string } | null;
  chainBrand: string | null;
}

interface AdviceRow {
  dup_referral_id: string | null;
  dup_referral_company: string | null;
  dup_deal_id: string | null;
  dup_deal_company: string | null;
  chain_brand: string | null;
}

/** Advisory only: an error simply shows no advice lines. */
export function useFormSubmissionAdvice(submissionId: string | null) {
  return useQuery({
    queryKey: ["referrals", "form-submission-advice", submissionId ?? "none"] as const,
    enabled: Boolean(submissionId),
    queryFn: async (): Promise<SubmissionAdvice> => {
      const { data, error } = await supabase.rpc("form_submission_advice", { p_submission_id: submissionId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as AdviceRow | null | undefined;
      return {
        duplicateReferral: row?.dup_referral_id
          ? { id: row.dup_referral_id, companyName: row.dup_referral_company ?? "" }
          : null,
        duplicateDeal: row?.dup_deal_id ? { id: row.dup_deal_id, companyName: row.dup_deal_company ?? "" } : null,
        chainBrand: row?.chain_brand ?? null,
      };
    },
    retry: false,
    staleTime: 30_000,
  });
}
