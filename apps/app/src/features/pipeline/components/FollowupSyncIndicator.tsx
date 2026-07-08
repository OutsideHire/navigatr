/**
 * FollowupSyncIndicator — subtle calendar-sync indicator for a deal's
 * follow-up ("Two-way calendar sync — Milestone 2, plan FM5").
 *
 * The `sync_followup` Edge fn reconciles a deal's `next_followup_at` to an
 * all-day Google Calendar event and stamps `followup_calendar_sync_status`
 * on the deal row. This surfaces that state next to the follow-up date on
 * Deal Detail, mirroring the appointment sync badge in UpcomingAppointments:
 *
 *   pending → "Syncing…"     (muted, priority-low badge)  — no action
 *   synced  → "On calendar"  (success tone, status-on-track badge)
 *   error   → "Not synced"   (danger tone, status-overdue badge) + Retry
 *   null / undefined         → renders nothing
 *
 * Retry re-invokes syncFollowup(dealId). Kept small and inline — it sits
 * beside the existing follow-up display, not in its own card.
 */

import { RefreshCw } from "lucide-react";

import { Badge, Button } from "@/components/navigatr";
import type { BadgeKind } from "@/components/navigatr";
import { useFollowupSync } from "@/features/appointments/useFollowupSync";

export type FollowupCalendarSyncStatus = "pending" | "synced" | "error";

/** Sync-status → badge label + kind. Mirrors UpcomingAppointments' SYNC_BADGE. */
const SYNC_BADGE: Record<FollowupCalendarSyncStatus, { label: string; kind: BadgeKind }> = {
  pending: { label: "Syncing…", kind: "priority-low" },
  synced: { label: "On calendar", kind: "status-on-track" },
  error: { label: "Not synced", kind: "status-overdue" },
};

export function FollowupSyncIndicator({
  dealId,
  status,
}: {
  dealId: string;
  status: FollowupCalendarSyncStatus | null | undefined;
}) {
  const { syncFollowup } = useFollowupSync();

  // No follow-up to sync (or unpopulated on older rows) → render nothing.
  if (!status) return null;

  const badge = SYNC_BADGE[status];

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge kind={badge.kind} size="sm">
        {badge.label}
      </Badge>
      {status === "error" && (
        <Button
          variant="tertiary"
          size="sm"
          leadingIcon={RefreshCw}
          onClick={() => void syncFollowup(dealId)}
        >
          Retry
        </Button>
      )}
    </span>
  );
}

export default FollowupSyncIndicator;
