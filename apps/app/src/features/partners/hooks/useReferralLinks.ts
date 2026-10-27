/**
 * Public referral form links (Phase 2B-1, FR-PORT-24..27). Every active user
 * has a personal link; administrators also have the company link. While the
 * ISO has the public form off, the server answers enabled: false with no
 * token and creates nothing, and the app shows no Share button.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export type ReferralLinkType = "user" | "tenant";

export interface ReferralLink {
  enabled: boolean;
  slug: string;
  token: string | null;
}

interface LinkRow {
  link_token: string | null;
  org_slug: string;
  public_form_enabled: boolean;
}

export const REFERRAL_LINK_QUERY_KEY = (kind: ReferralLinkType, userId?: string) =>
  ["referral-links", kind, userId ?? "anon"] as const;

export function toReferralLink(data: unknown): ReferralLink | null {
  const row = (Array.isArray(data) ? data[0] : data) as LinkRow | null | undefined;
  if (!row || typeof row !== "object") return null;
  return { enabled: row.public_form_enabled === true, slug: row.org_slug, token: row.link_token ?? null };
}

export function useMyReferralLink() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: REFERRAL_LINK_QUERY_KEY("user", userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<ReferralLink | null> => {
      const { data, error } = await supabase.rpc("get_my_referral_link");
      if (error) throw error;
      return toReferralLink(data);
    },
    staleTime: 5 * 60_000,
  });
}

export function useTenantReferralLink(enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: REFERRAL_LINK_QUERY_KEY("tenant", userId),
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<ReferralLink | null> => {
      const { data, error } = await supabase.rpc("get_tenant_referral_link");
      if (error) throw error;
      return toReferralLink(data);
    },
    staleTime: 5 * 60_000,
  });
}

export function useRegenerateReferralLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { linkType: ReferralLinkType; userId?: string }): Promise<string> => {
      // userId is for an administrator renewing another user's link (FR-PORT-27).
      const { data, error } = await supabase.rpc("regenerate_referral_link", {
        p_link_type: input.linkType,
        ...(input.userId ? { p_user_id: input.userId } : {}),
      });
      if (error) {
        throw new Error(
          error.message.includes("not_authorized") ? "You don't have access to do that." : "Couldn't get a new link. Try again.",
        );
      }
      // The server returns null (and changes nothing) while the ISO has the public form off.
      if (typeof data !== "string" || data === "") throw new Error("The referral form is turned off right now.");
      return data;
    },
    // Returned, so mutateAsync resolves only once both links (and their QR codes) are fresh.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["referral-links"] }),
  });
}
