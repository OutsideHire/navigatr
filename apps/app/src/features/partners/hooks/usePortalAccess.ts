/**
 * Partner portal access from the partner record (spec 5.3, FR-PORT-13/20/23).
 *
 * Status reads go through the portal_users SELECT policy (can_see_partner) and
 * only the columns granted to the app role. The invite goes through the
 * portal_invite edge function, so a rep never sees the invite link. Suspend,
 * revoke and restore go through portal_set_access.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { functionErrorCode, type PortalAccessChange, type PortalUserStatus } from "../lib/portalAccess";

export interface PortalStatus {
  enabled: boolean;
  slug: string;
}

export interface PartnerPortalUser {
  partnerId: string;
  status: PortalUserStatus;
  invitedAt: string | null;
  activatedAt: string | null;
  lastLoginAt: string | null;
}

interface PortalUserRow {
  partner_id: string;
  status: PortalUserStatus;
  invited_at: string | null;
  activated_at: string | null;
  last_login_at: string | null;
}

export const PORTAL_STATUS_QUERY_KEY = (userId?: string) => ["portal", "status", userId ?? "anon"] as const;
export const PARTNER_PORTAL_USER_QUERY_KEY = (partnerId?: string) =>
  ["portal", "user", partnerId ?? "none"] as const;

export function usePortalStatus() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: PORTAL_STATUS_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<PortalStatus> => {
      const { data, error } = await supabase.rpc("get_portal_status");
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { enabled?: boolean; slug?: string } | null | undefined;
      return { enabled: Boolean(row?.enabled), slug: row?.slug ?? "" };
    },
    staleTime: 5 * 60_000,
  });
}

export function usePartnerPortalUser(partnerId: string | undefined) {
  return useQuery({
    queryKey: PARTNER_PORTAL_USER_QUERY_KEY(partnerId),
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<PartnerPortalUser | null> => {
      const { data, error } = await supabase
        .from("portal_users")
        .select("partner_id, status, invited_at, activated_at, last_login_at")
        .eq("partner_id", partnerId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as PortalUserRow;
      return {
        partnerId: row.partner_id,
        status: row.status,
        invitedAt: row.invited_at,
        activatedAt: row.activated_at,
        lastLoginAt: row.last_login_at,
      };
    },
    staleTime: 30_000,
  });
}

export function useInviteToPortal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (partnerId: string): Promise<{ emailed: boolean }> => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; emailed?: boolean }>("portal_invite", {
        body: { partnerId },
      });
      if (error) throw new Error(await functionErrorCode(error, "invite_failed"));
      return { emailed: Boolean(data?.emailed) };
    },
    // onSettled, not onSuccess: after a 502 email_failed the invite row exists,
    // so the button must flip to "Resend invite".
    onSettled: (_result, _error, partnerId) => {
      void queryClient.invalidateQueries({ queryKey: PARTNER_PORTAL_USER_QUERY_KEY(partnerId) });
    },
  });
}

export function useSetPortalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { partnerId: string; status: PortalAccessChange }): Promise<PortalUserStatus> => {
      const { data, error } = await supabase.rpc("portal_set_access", {
        p_partner_id: args.partnerId,
        p_status: args.status,
      });
      if (error) throw error;
      return data as PortalUserStatus;
    },
    onSuccess: (_result, args) => {
      void queryClient.invalidateQueries({ queryKey: PARTNER_PORTAL_USER_QUERY_KEY(args.partnerId) });
    },
  });
}
