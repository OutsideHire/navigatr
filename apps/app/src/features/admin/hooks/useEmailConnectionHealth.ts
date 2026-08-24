/**
 * useEmailConnectionHealth — the admin readout of reps' Outlook email-capture
 * connections (Email Capture Phase 1, Slice 5d). Calls the admin-gated
 * email_connection_health RPC; a non-admin gets an empty set (the RPC enforces
 * this), so the card simply renders empty for them.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { EmailConnectionHealthRow } from "../lib/emailConnectionHealth";

export const EMAIL_CONNECTION_HEALTH_QUERY_KEY = (userId: string | undefined) =>
  ["email-connection-health", userId ?? "anon"] as const;

export function useEmailConnectionHealth() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: EMAIL_CONNECTION_HEALTH_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<EmailConnectionHealthRow[]> => {
      const { data, error } = await supabase.rpc("email_connection_health");
      if (error) throw error;
      return (data ?? []) as EmailConnectionHealthRow[];
    },
    staleTime: 5 * 60_000,
  });
}
