/**
 * UpcomingAppointments — Deal Detail right-rail list of a deal's booked
 * appointments ("Two-way calendar sync — Milestone 1").
 *
 * Reads useDealAppointments(dealId) (deal-scoped, non-cancelled, ordered by
 * start time) and renders one row per appointment: local-timezone start time,
 * title, optional location, and a calendar-sync badge. Each row has a Cancel
 * action; an errored sync additionally gets a Retry action.
 *
 * Sync badge mapping (calendarSyncStatus):
 *   pending → "Syncing…"     (muted, priority-low badge)
 *   synced  → "On calendar"  (success tone, status-on-track badge)
 *   error   → "Not synced"   (danger tone, status-overdue badge) + Retry
 *
 * Cancel / Retry both call the mutations with { id, dealId } so the hook can
 * invalidate the right list query. Empty state renders nothing (the deal
 * right-rail already has enough surfaces; an empty card would be noise).
 */

import { RefreshCw, X } from "lucide-react";

import { Badge, Button, Card } from "@/components/navigatr";
import type { BadgeKind } from "@/components/navigatr";

import {
  useCancelAppointment,
  useDealAppointments,
  useRetryAppointmentSync,
} from "./useAppointments";
import type { CalendarSyncStatus, ScheduledAppointment } from "./types";

/** Sync-status → badge label + kind. */
const SYNC_BADGE: Record<CalendarSyncStatus, { label: string; kind: BadgeKind }> = {
  pending: { label: "Syncing…", kind: "priority-low" },
  synced: { label: "On calendar", kind: "status-on-track" },
  error: { label: "Not synced", kind: "status-overdue" },
};

/**
 * Format a UTC ISO timestamp in the rep's local timezone, e.g.
 * "Fri Jul 10, 10:00 AM". Uses toLocaleString so the browser applies the
 * viewer's timezone + locale.
 */
function formatApptTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AppointmentRow({ appt }: { appt: ScheduledAppointment }) {
  const cancel = useCancelAppointment();
  const retry = useRetryAppointmentSync();
  const badge = SYNC_BADGE[appt.calendarSyncStatus];

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-text-default">{appt.title}</p>
          <p className="text-caption tabular-nums text-text-muted">
            {formatApptTime(appt.startAt)}
          </p>
          {appt.locationAddress && (
            <p className="mt-0.5 truncate text-caption text-text-muted">
              {appt.locationAddress}
            </p>
          )}
        </div>
        <Badge kind={badge.kind} size="sm">
          {badge.label}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {appt.calendarSyncStatus === "error" && (
          <Button
            variant="tertiary"
            size="sm"
            leadingIcon={RefreshCw}
            loading={retry.isPending}
            onClick={() => retry.mutate({ id: appt.id, dealId: appt.dealId })}
          >
            Retry
          </Button>
        )}
        <Button
          variant="tertiary"
          size="sm"
          leadingIcon={X}
          loading={cancel.isPending}
          onClick={() => cancel.mutate({ id: appt.id, dealId: appt.dealId })}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function UpcomingAppointments({ dealId }: { dealId: string }) {
  const { data: appointments = [] } = useDealAppointments(dealId);

  // Empty state: render nothing. The right rail already has enough surfaces;
  // an empty "no appointments" card would be noise before anything is booked.
  if (appointments.length === 0) return null;

  return (
    <Card padding="md" shadow="sm" className="flex flex-col gap-2">
      <h2 className="text-body-strong text-text-default">Upcoming appointments</h2>
      <div className="flex flex-col divide-y divide-border-subtle">
        {appointments.map((appt) => (
          <AppointmentRow key={appt.id} appt={appt} />
        ))}
      </div>
    </Card>
  );
}

export default UpcomingAppointments;
