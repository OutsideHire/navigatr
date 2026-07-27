/**
 * usePersistenceIndex — the Persistence Index for the current viewer.
 *
 * Reads the RLS-scoped deals + org activities and runs the pure
 * `computePersistenceIndex` engine, scoped to the signed-in user as owner.
 * Returns null before auth resolves (no ownerId yet) so the widget can show
 * a loading-safe empty state instead of a misleading zero.
 */

import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useAuth } from "@/stores/auth";
import { computePersistenceIndex, type PersistenceIndexResult } from "../lib/persistenceIndex";
import { useFutureAppointmentDealIds, withFutureAppointmentFlag, EMPTY_DEAL_ID_SET } from "./useFutureAppointmentDealIds";

export function usePersistenceIndex(): PersistenceIndexResult | null {
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  const ownerId = useAuth((s) => s.user?.id);
  const futureApptIds = useFutureAppointmentDealIds().data ?? EMPTY_DEAL_ID_SET;
  return React.useMemo(() => {
    if (!ownerId) return null;
    return computePersistenceIndex(withFutureAppointmentFlag(deals, futureApptIds), activities, { ownerId, now: new Date() });
  }, [deals, activities, ownerId, futureApptIds]);
}
