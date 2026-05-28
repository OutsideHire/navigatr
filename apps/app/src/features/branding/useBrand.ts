/**
 * useBrand — read the current org's white-label settings.
 *
 * Backed by the org_branding table (migration 20260528000001). Returns a
 * fully-defaulted Brand shape so consumers don't have to guard against
 * "branding row doesn't exist yet" — they always get a working theme,
 * either the org's customizations or the navigatr defaults.
 *
 * Cache key tail = orgId so signing into a different org gets fresh data.
 * Long staleTime because branding rarely changes inside one session.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";

export interface Brand {
  productName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  showPoweredBy: boolean;
}

interface BrandRow {
  product_name: string;
  primary_color: string | null;
  logo_url: string | null;
  show_powered_by: boolean;
}

// The defaults match what an org sees if no org_branding row exists. They
// also drive the form's "reset to defaults" affordance.
export const DEFAULT_BRAND: Brand = {
  productName: "navigatr",
  primaryColor: null,    // null = use the design system default
  logoUrl: null,
  showPoweredBy: true,
};

export const ORG_BRANDING_QUERY_KEY = (orgId: string | undefined) =>
  ["org-branding", orgId ?? "none"] as const;

export function useBrand() {
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const orgId = profile.data?.org_id;

  return useQuery<Brand>({
    queryKey: ORG_BRANDING_QUERY_KEY(orgId),
    enabled: Boolean(userId && orgId),
    queryFn: async (): Promise<Brand> => {
      const { data, error } = await supabase
        .from("org_branding")
        .select("product_name, primary_color, logo_url, show_powered_by")
        .eq("org_id", orgId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return DEFAULT_BRAND;
      const row = data as BrandRow;
      return {
        productName: row.product_name,
        primaryColor: row.primary_color,
        logoUrl: row.logo_url,
        showPoweredBy: row.show_powered_by,
      };
    },
    // Branding mutates rarely (admin action). 5 minutes is enough to
    // avoid refetch storms when many components subscribe.
    staleTime: 5 * 60_000,
  });
}
