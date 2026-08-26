/**
 * useOnboardingProgress — real-count activation state for the ISO-admin
 * Get-Started checklist (onboarding A1). The activation north star is "team
 * invited", so the steps derive from actual org counts, never a dismiss flag:
 *
 *   1. Workspace created  — always done (they're in an org)
 *   2. Invite your team   — >= 1 invite sent (the emphasized step)
 *   3. First teammate joins — >= 2 people in the org
 *   4. See your team in action — >= 1 activity OR >= 1 deal
 *
 * The derivation is a pure function (exhaustively unit-tested); the hook just
 * fetches RLS-scoped head counts and feeds them in. Counts fail toward "not
 * done" so a read blip never hides activation guidance.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface OnboardingCounts {
  invitesSent: number;
  orgMemberCount: number;
  orgActivityCount: number;
  orgDealCount: number;
}

export interface OnboardingStep {
  key: "workspace" | "invite" | "teammate" | "activity";
  label: string;
  done: boolean;
  /** Route the step's CTA navigates to (absent = no action / auto). */
  ctaTo?: string;
  /** The primary push while undone (the activation north star). */
  emphasized?: boolean;
}

/** Pure: counts -> ordered checklist steps. */
export function deriveOnboardingSteps(c: OnboardingCounts): OnboardingStep[] {
  return [
    { key: "workspace", label: "Create your workspace", done: true },
    {
      key: "invite",
      label: "Invite your team",
      done: c.invitesSent >= 1,
      ctaTo: "/welcome",
      emphasized: true,
    },
    { key: "teammate", label: "Your first teammate joins", done: c.orgMemberCount >= 2 },
    {
      key: "activity",
      label: "See your team in action",
      done: c.orgActivityCount >= 1 || c.orgDealCount >= 1,
      ctaTo: "/pipeline",
    },
  ];
}

export function allStepsComplete(steps: OnboardingStep[]): boolean {
  return steps.every((s) => s.done);
}

const ZERO: OnboardingCounts = {
  invitesSent: 0,
  orgMemberCount: 0,
  orgActivityCount: 0,
  orgDealCount: 0,
};

/** RLS-scoped head count of a table with optional `.is(col, null)` filters. */
async function headCount(
  table: string,
  nullFilters: string[] = [],
): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  for (const col of nullFilters) q = q.is(col, null);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export function useOnboardingProgress() {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: ["onboarding-progress", userId ?? "anon"],
    enabled: Boolean(userId),
    queryFn: async (): Promise<OnboardingCounts> => {
      // All RLS-scoped to the caller's org. Invites = any row ever sent;
      // members = active profiles; activity/deal = presence of real work.
      const [invitesSent, orgMemberCount, orgActivityCount, orgDealCount] =
        await Promise.all([
          headCount("org_invites"),
          headCount("profiles", ["deactivated_at"]),
          headCount("activities"),
          headCount("deals"),
        ]);
      return { invitesSent, orgMemberCount, orgActivityCount, orgDealCount };
    },
    staleTime: 30_000,
  });

  // Fail toward showing the checklist: unknown counts are treated as zero
  // (nothing done) rather than hiding activation guidance.
  const counts = query.data ?? ZERO;
  const steps = deriveOnboardingSteps(counts);
  return {
    counts,
    steps,
    allComplete: query.isSuccess && allStepsComplete(steps),
    isLoading: query.isLoading,
  };
}
