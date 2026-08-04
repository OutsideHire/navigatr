/**
 * useGlobalSearch — the data behind the TopBar global search.
 *
 * Runs three RLS-scoped ilike queries in parallel (deals, partners,
 * activities) and returns up to PER_GROUP matches per group, mapped to a
 * uniform result shape the palette can render and navigate. RLS scopes each
 * query to what the caller may see, so a rep searches their own book and a
 * manager the team, with no extra plumbing.
 *
 * The query term is sanitized (drops the characters that would break a
 * PostgREST `.or()` filter) and only runs at >= 2 characters. Per-group errors
 * are swallowed to an empty group so one failing table never blanks the others.
 *
 * Debouncing lives in the component (it owns the input); this hook keys its
 * React Query cache on the already-debounced term.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { STAGE_LABEL, type DealStage } from "@/features/pipeline/mockData";

export type SearchResultKind = "deal" | "partner" | "activity";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  label: string;
  sublabel: string;
  /** Route to navigate to on select. */
  to: string;
}

export interface GlobalSearchResults {
  deals: SearchResult[];
  partners: SearchResult[];
  activities: SearchResult[];
}

const EMPTY: GlobalSearchResults = { deals: [], partners: [], activities: [] };
const PER_GROUP = 5;

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  call: "Call",
  email: "Email",
  drop_in: "Drop-in",
  appointment: "Appointment",
};

/** Strip characters that break a PostgREST `.or()` value (commas, parens, the
 *  `*`/`%` wildcards, backslash) and collapse whitespace. */
export function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Supabase types a to-one embedded select as either an object or a 1-element
 *  array depending on inference; normalize to the first row's company_name. */
function embeddedCompany(deals: unknown): string | null {
  if (!deals) return null;
  const row = Array.isArray(deals) ? deals[0] : deals;
  return (row as { company_name?: string } | undefined)?.company_name ?? null;
}

export function useGlobalSearch(debouncedQuery: string): {
  results: GlobalSearchResults;
  isLoading: boolean;
  /** True once the term is long enough to search (>= 2 chars). */
  isEnabled: boolean;
} {
  const term = sanitizeSearchTerm(debouncedQuery);
  const enabled = term.length >= 2;

  const query = useQuery({
    queryKey: ["global-search", term],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<GlobalSearchResults> => {
      const like = `*${term}*`;
      const [dealsRes, partnersRes, activitiesRes] = await Promise.all([
        supabase
          .from("deals")
          .select("id, company_name, contact_name, stage")
          .or(`company_name.ilike.${like},contact_name.ilike.${like},contact_email.ilike.${like}`)
          .limit(PER_GROUP),
        supabase
          .from("partners")
          .select("id, name, company")
          .or(`name.ilike.${like},company.ilike.${like},email.ilike.${like}`)
          .limit(PER_GROUP),
        supabase
          .from("activities")
          .select("id, type, outcome_notes, occurred_at, deal_id, deals(company_name)")
          .ilike("outcome_notes", `%${term}%`)
          .order("occurred_at", { ascending: false })
          .limit(PER_GROUP),
      ]);

      const deals: SearchResult[] = (dealsRes.error ? [] : dealsRes.data ?? []).map((d) => ({
        kind: "deal" as const,
        id: d.id as string,
        label: (d.company_name as string) || "Untitled deal",
        sublabel: [d.contact_name as string | null, STAGE_LABEL[d.stage as DealStage]]
          .filter(Boolean)
          .join(" · "),
        to: `/pipeline/${d.id}`,
      }));

      const partners: SearchResult[] = (partnersRes.error ? [] : partnersRes.data ?? []).map((p) => ({
        kind: "partner" as const,
        id: p.id as string,
        label: (p.name as string) || "Partner",
        sublabel: (p.company as string) || "",
        to: `/partners/${p.id}`,
      }));

      const activities: SearchResult[] = (activitiesRes.error ? [] : activitiesRes.data ?? []).map(
        (a) => {
          const company = embeddedCompany((a as { deals?: unknown }).deals);
          const typeLabel = ACTIVITY_TYPE_LABEL[a.type as string] ?? "Activity";
          return {
            kind: "activity" as const,
            id: a.id as string,
            label: company ? `${typeLabel}: ${company}` : typeLabel,
            sublabel: truncate((a.outcome_notes as string) || "", 64),
            // Activities have no detail route; jump to the parent deal.
            to: `/pipeline/${a.deal_id}`,
          };
        },
      );

      return { deals, partners, activities };
    },
  });

  return {
    results: query.data ?? EMPTY,
    isLoading: enabled && query.isLoading,
    isEnabled: enabled,
  };
}
