/**
 * Pure matching for the W2c pending-outcome nudge: which scheduled
 * appointments have an end time in the past but no outcome recorded yet.
 * Mirrors computeUnloggedDials (activities feature) as the pattern, runs on
 * read (no job). Keys off the DB row shape directly (snake_case) rather than
 * a mapped camelCase type, since useAppointmentsAwaitingOutcome selects
 * exactly these columns from scheduled_appointments.
 */

export interface AppointmentForOutcomeCheck {
  id: string;
  deal_id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  outcome: string | null;
}

/**
 * Returns the appointments that are past-due and unlogged: end_at in the
 * past, status still 'scheduled', and outcome not yet recorded. Sorted by
 * end_at ascending (oldest miss first). Generic over T so callers can pass
 * rows with extra fields (e.g. the hook's raw query result) and get them
 * back untouched.
 */
export function computeAwaitingOutcome<T extends AppointmentForOutcomeCheck>(
  appointments: T[],
  now: Date,
): T[] {
  const nowMs = now.getTime();
  return appointments
    .filter(
      (a) =>
        a.status === "scheduled" &&
        a.outcome == null &&
        new Date(a.end_at).getTime() < nowMs,
    )
    .sort((a, b) => new Date(a.end_at).getTime() - new Date(b.end_at).getTime());
}
