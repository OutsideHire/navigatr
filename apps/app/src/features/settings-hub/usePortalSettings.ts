/**
 * Partner portal tenant settings (spec 5.10). Admin only, enforced in SQL by
 * get_portal_settings / update_portal_settings (caller_is_admin). Reading through
 * an RPC keeps the organizations RLS policy unchanged.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PortalSettings {
  enabled: boolean;
  termsText: string | null;
  termsVersion: number;
  consentText: string | null;
  consentVersion: number;
  valueVisibility: boolean;
  publicFormEnabled: boolean;
  slug: string;
  orgName: string;
}

export interface PortalSettingsInput {
  enabled: boolean;
  termsText: string;
  consentText: string;
  valueVisibility: boolean;
}

interface PortalSettingsRow {
  enabled: boolean;
  terms_text: string | null;
  terms_version: number;
  consent_text: string | null;
  consent_version: number;
  value_visibility: boolean;
  public_form_enabled?: boolean;
  slug: string;
  org_name: string;
}

export const PORTAL_SETTINGS_QUERY_KEY = ["portal", "settings"] as const;

function toSettings(data: unknown): PortalSettings {
  const row = (Array.isArray(data) ? data[0] : data) as PortalSettingsRow | null | undefined;
  if (!row) throw new Error("portal_settings_missing");
  return {
    enabled: row.enabled,
    termsText: row.terms_text,
    termsVersion: row.terms_version,
    consentText: row.consent_text,
    consentVersion: row.consent_version,
    valueVisibility: row.value_visibility,
    publicFormEnabled: row.public_form_enabled ?? false,
    slug: row.slug,
    orgName: row.org_name,
  };
}

export function usePortalSettings() {
  return useQuery({
    queryKey: PORTAL_SETTINGS_QUERY_KEY,
    queryFn: async (): Promise<PortalSettings> => {
      const { data, error } = await supabase.rpc("get_portal_settings");
      if (error) throw error;
      return toSettings(data);
    },
  });
}

export function useUpdatePortalSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PortalSettingsInput): Promise<PortalSettings> => {
      const { data, error } = await supabase.rpc("update_portal_settings", {
        p_enabled: input.enabled,
        p_terms_text: input.termsText,
        p_consent_text: input.consentText,
        p_value_visibility: input.valueVisibility,
      });
      if (error) throw error;
      return toSettings(data);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(PORTAL_SETTINGS_QUERY_KEY, settings);
      void queryClient.invalidateQueries({ queryKey: ["portal", "status"] });
    },
  });
}

/**
 * The public referral form switch (FR-PORT-28). Saves the moment it is flipped,
 * separately from the Save button. The server refuses to turn it on while the
 * portal is off (portal_disabled). Links depend on it, so they are refetched.
 */
export function useSetPublicFormEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<PortalSettings> => {
      const { data, error } = await supabase.rpc("set_public_form_enabled", { p_enabled: enabled });
      if (error) {
        throw new Error(
          error.message?.includes("portal_disabled")
            ? "Turn on the partner portal and save first."
            : "Couldn't change the public referral form. Try again.",
        );
      }
      return toSettings(data);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(PORTAL_SETTINGS_QUERY_KEY, settings);
      void queryClient.invalidateQueries({ queryKey: ["referral-links"] });
    },
  });
}
