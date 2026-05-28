/**
 * useUpdateBrand — admin-only write to org_branding via RPC.
 *
 * The RPC accepts nullable params, so "partial update" is the natural shape.
 * Callers pass only the fields they want to change. On success we invalidate
 * the org-branding query — BrandProvider re-applies the new theme on the
 * next render automatically.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ORG_BRANDING_QUERY_KEY, type Brand } from "./useBrand";
import { useProfile } from "@/features/auth/useProfile";

export interface BrandPatch {
  productName?: string | null;
  primaryColor?: string | null;
  logoUrl?: string | null;
  showPoweredBy?: boolean | null;
}

interface BrandRpcRow {
  product_name: string;
  primary_color: string | null;
  logo_url: string | null;
  show_powered_by: boolean;
}

export function useUpdateBrand() {
  const qc = useQueryClient();
  const profile = useProfile();
  const orgId = profile.data?.org_id;

  return useMutation<Brand, Error, BrandPatch>({
    mutationFn: async (patch) => {
      const { data, error } = await supabase.rpc("update_org_branding", {
        p_product_name:    patch.productName    ?? null,
        p_primary_color:   patch.primaryColor   ?? null,
        p_logo_url:        patch.logoUrl        ?? null,
        p_show_powered_by: patch.showPoweredBy  ?? null,
      });
      if (error) throw new Error(error.message);
      const row = data as unknown as BrandRpcRow;
      return {
        productName:   row.product_name,
        primaryColor:  row.primary_color,
        logoUrl:       row.logo_url,
        showPoweredBy: row.show_powered_by,
      };
    },
    onSuccess: () => {
      // Invalidate so BrandProvider + any UI surface reading the brand
      // refetches and the theme switches in-place.
      qc.invalidateQueries({ queryKey: ORG_BRANDING_QUERY_KEY(orgId) });
    },
  });
}
