/**
 * useDirectReports — assembles the "Direct reports" table rows for the
 * Persistence Index report (SP-1). Reuses the same client-side persistence
 * functions the report already relies on (computePerRepPersistence for the
 * composite, computePersistenceHistory for each rep's trailing series) and adds
 * name + role-level label from profiles. All the shaping logic lives in the
 * pure assembleDirectReportInputs; this hook just gathers the cached data and
 * injects the per-rep history provider.
 *
 * Manager/admin only, matching the report page; reps never render this.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { computePerRepPersistence, computePersistenceHistory } from "../lib/persistenceIndex";
import { assembleDirectReportInputs, type DirectReportInput } from "../lib/directReports";
import { ROLE_LEVEL_OPTIONS, type RoleLevel } from "@/features/auth/capabilities";
import {
  useFutureAppointmentDealIds,
  withFutureAppointmentFlag,
  EMPTY_DEAL_ID_SET,
} from "./useFutureAppointmentDealIds";

/** Trailing window for the sparkline + activity count (30-day delta reads the
 *  last 30 points of this same series). */
const SPARK_WINDOW_DAYS = 60;

const ROLE_LABEL = new Map(ROLE_LEVEL_OPTIONS.map((o) => [o.value, o.label] as const));

interface MemberRow {
  id: string;
  full_name: string | null;
  email: string;
  role_level: string | null;
}

export function useDirectReports(enabled = true): DirectReportInput[] {
  const userId = useAuth((s) => s.user?.id);
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  const futureApptIds = useFutureAppointmentDealIds().data ?? EMPTY_DEAL_ID_SET;

  const membersQuery = useQuery({
    queryKey: ["directReportMembers", userId ?? "anon"],
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role_level");
      if (error) throw error;
      return (data ?? []) as MemberRow[];
    },
    staleTime: 5 * 60_000,
  });

  const memberData = membersQuery.data;

  return React.useMemo(() => {
    if (!enabled) return [];
    const flagged = withFutureAppointmentFlag(deals, futureApptIds);
    const now = new Date();
    const roster = computePerRepPersistence(flagged, activities, { now });

    const members = new Map<string, { name: string; role: string | null }>();
    for (const m of memberData ?? []) {
      members.set(m.id, {
        name: m.full_name ?? m.email,
        role: m.role_level ? ROLE_LABEL.get(m.role_level as RoleLevel) ?? null : null,
      });
    }

    return assembleDirectReportInputs({
      roster,
      deals: flagged,
      activities,
      members,
      historyFor: (ownerId) =>
        computePersistenceHistory(flagged, activities, {
          now,
          rangeDays: SPARK_WINDOW_DAYS,
          ownerId,
          team: false,
        }),
      now,
      windowDays: SPARK_WINDOW_DAYS,
    });
  }, [enabled, deals, activities, futureApptIds, memberData]);
}
