/**
 * AppointmentsAwaitingOutcome: W2c nudge on the Activities page. Lists the
 * rep's scheduled appointments whose end time has passed with no outcome
 * recorded yet, one row per appointment, with a one-tap action to log the
 * outcome via AppointmentOutcomeSheet (built in W2b-2). Data-quality
 * framing, not compliance, same posture as UnloggedCallsSection (the
 * click-to-call nudge this mirrors). Renders nothing when there is nothing
 * to nudge.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import {
  useAppointmentsAwaitingOutcome,
  APPOINTMENTS_AWAITING_OUTCOME_QUERY_KEY,
  type AppointmentAwaitingOutcomeView,
} from "../hooks/useAppointmentsAwaitingOutcome";
import { AppointmentOutcomeSheet } from "./AppointmentOutcomeSheet";
import { useAuth } from "@/stores/auth";

/**
 * Short relative time, e.g. "3h ago" / "2d ago" / "just now". Mirrors
 * UnloggedCallsSection's relativeTime exactly (same floor-at-boundary
 * behavior), duplicated here rather than imported to keep this component
 * decoupled from the activities feature. Exported for direct branch testing.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AppointmentsAwaitingOutcome() {
  const { data: items = [] } = useAppointmentsAwaitingOutcome();
  const [selected, setSelected] = React.useState<AppointmentAwaitingOutcomeView | null>(null);
  const userId = useAuth((s) => s.user?.id);
  const queryClient = useQueryClient();

  if (items.length === 0) return null;

  const closeSheet = () => {
    setSelected(null);
    // AppointmentOutcomeSheet has no onLogged-style success callback (unlike
    // LogActivitySheet): its own mutation invalidates the deal/activities
    // caches but doesn't know about this nudge's query. Invalidating on
    // every close (cancel or a successful log) is cheap and always correct.
    void queryClient.invalidateQueries({
      queryKey: APPOINTMENTS_AWAITING_OUTCOME_QUERY_KEY(userId),
    });
  };

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-accent-teal" aria-hidden />
        <h2 className="text-heading-sm text-text-default">
          Appointments to log ({items.length})
        </h2>
      </div>
      <p className="text-body-sm text-text-muted">
        These appointments have ended but don&apos;t have an outcome yet.
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-radius-sm bg-surface-sunken px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-label text-text-default">{item.companyName}</p>
              <p className="truncate text-body-sm text-text-muted">{item.title}</p>
              <p className="text-body-sm text-text-muted">Ended {relativeTime(item.endAt)}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setSelected(item)}>
              Log outcome
            </Button>
          </li>
        ))}
      </ul>

      {selected && (
        <AppointmentOutcomeSheet
          open
          onOpenChange={(o) => {
            if (!o) closeSheet();
          }}
          appointmentId={selected.id}
          dealId={selected.dealId}
          merchantName={selected.companyName}
          hasFutureAppointment={selected.hasFutureAppointment}
        />
      )}
    </Card>
  );
}

export default AppointmentsAwaitingOutcome;
