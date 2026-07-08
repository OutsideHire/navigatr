/**
 * PathBlockSyncIndicator — subtle calendar-sync indicator for a planned path's
 * all-day Google Calendar block ("Two-way calendar sync — Milestone 3, plan
 * PM5").
 *
 * The `sync_path` Edge fn reconciles a planned path to an all-day Google
 * Calendar block and stamps `path_calendar_sync_status` on the path row. This
 * surfaces that state on each planned-path row in Upcoming paths, mirroring the
 * follow-up sync badge (FollowupSyncIndicator):
 *
 *   pending → "Syncing…"     (muted, priority-low badge)  — no action
 *   synced  → "On calendar"  (success tone, status-on-track badge)
 *   error   → "Not synced"   (danger tone, status-overdue badge) + Retry
 *   null / undefined         → renders nothing
 *
 * Retry re-invokes syncPath(pathId). Kept small and inline — it sits on the
 * existing row, not in its own element.
 */

import { RefreshCw } from "lucide-react";

import { Badge, Button } from "@/components/navigatr";
import type { BadgeKind } from "@/components/navigatr";
import { usePathCalendarSync } from "../hooks/usePathCalendarSync";
import type { PathCalendarSyncStatus } from "../lib/pathTypes";

/** Sync-status → badge label + kind. Mirrors FollowupSyncIndicator's SYNC_BADGE. */
const SYNC_BADGE: Record<PathCalendarSyncStatus, { label: string; kind: BadgeKind }> = {
  pending: { label: "Syncing…", kind: "priority-low" },
  synced: { label: "On calendar", kind: "status-on-track" },
  error: { label: "Not synced", kind: "status-overdue" },
};

export function PathBlockSyncIndicator({
  pathId,
  status,
}: {
  pathId: string;
  status: PathCalendarSyncStatus | null | undefined;
}) {
  const { syncPath } = usePathCalendarSync();

  // Nothing to sync (or unpopulated on older rows) → render nothing.
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
          onClick={() => void syncPath(pathId)}
        >
          Retry
        </Button>
      )}
    </span>
  );
}

export default PathBlockSyncIndicator;
