/**
 * useOrgProfession — the single read path for "what profession is this org."
 *
 * Returns the effective profession with full fallback:
 *   1. organizations.profession (admin-set at org level)
 *   2. user_metadata.profession (per-user, legacy onboarding step)
 *   3. null (UI should render generic copy via TERM_FALLBACKS)
 *
 * Plus the org's optional config row from org_profession_config (terminology
 * overrides + hidden fields + pipeline stages). Consumers usually want
 * useTerm() or useFieldVisible() rather than this raw shape.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth, getProfession as getUserProfession } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import type { Profession } from "./terminology";

export interface OrgProfessionShape {
  profession: Profession | null;
  terminology: Record<string, string>;
  hiddenFields: string[];
  pipelineStages: string[];
}

interface OrgRow { profession: string | null }
interface CfgRow {
  terminology: Record<string, string> | null;
  hidden_fields: string[] | null;
  pipeline_stages: string[] | null;
}

export const ORG_PROFESSION_QUERY_KEY = (orgId: string | undefined) =>
  ["org-profession", orgId ?? "none"] as const;

function isProfession(v: string | null | undefined): v is Profession {
  return v === "payroll" || v === "merchant_services" || v === "treasury_management";
}

export function useOrgProfession() {
  const user = useAuth((s) => s.user);
  const profile = useProfile();
  const orgId = profile.data?.org_id;

  return useQuery<OrgProfessionShape>({
    queryKey: ORG_PROFESSION_QUERY_KEY(orgId),
    enabled: Boolean(user && orgId),
    queryFn: async (): Promise<OrgProfessionShape> => {
      // Two reads, intentionally not parallelized — both are tiny and the
      // org-level profession decides whether we even need to query config
      // in future optimization passes. Sequential keeps the code dead-simple.
      const orgRes = await supabase
        .from("organizations")
        .select("profession")
        .eq("id", orgId!)
        .maybeSingle();
      if (orgRes.error) throw new Error(orgRes.error.message);

      const cfgRes = await supabase
        .from("org_profession_config")
        .select("terminology, hidden_fields, pipeline_stages")
        .eq("org_id", orgId!)
        .maybeSingle();
      if (cfgRes.error) throw new Error(cfgRes.error.message);

      const orgRow = orgRes.data as OrgRow | null;
      const cfgRow = cfgRes.data as CfgRow | null;

      // Fallback chain. orgRow.profession may be set to a value we don't
      // recognize (e.g. v1.1 added "insurance" but this build hasn't
      // shipped yet) — isProfession filters out unknowns so the UI uses
      // fallback copy instead of crashing.
      const orgProfessionRaw = orgRow?.profession ?? null;
      const userProfession = getUserProfession(user);
      const profession: Profession | null = isProfession(orgProfessionRaw)
        ? orgProfessionRaw
        : userProfession;

      return {
        profession,
        terminology: cfgRow?.terminology ?? {},
        hiddenFields: cfgRow?.hidden_fields ?? [],
        pipelineStages: cfgRow?.pipeline_stages ?? [],
      };
    },
    // Profession + config rarely change in-session; 5 minutes keeps the
    // query cheap when many components subscribe.
    staleTime: 5 * 60_000,
  });
}
