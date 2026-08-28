/**
 * AppointmentsAwaitingCard: manager/admin rollup of per-rep counts of
 * scheduled appointments awaiting an outcome (W2d). Mirrors TeamCoverageCard's
 * shape: a small card, manager/admin only, one row per rep with a nonzero
 * awaiting count plus a running total. Renders nothing for a non-manager
 * caller or when there are no visible reps at all, and an empty-friendly
 * state (no list) when every visible rep is caught up.
 */
import { Card } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useAppointmentsAwaitingRollup } from "../hooks/useAppointmentsAwaitingRollup";

export function AppointmentsAwaitingCard() {
  const role = useProfile().data?.role;
  const { rows } = useAppointmentsAwaitingRollup();

  if (role !== "manager" && role !== "admin") return null;
  if (rows.length === 0) return null;

  const awaiting = rows.filter((r) => r.awaitingCount > 0);
  const total = awaiting.reduce((sum, r) => sum + r.awaitingCount, 0);

  return (
    <Card padding="lg" shadow="sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-heading-sm text-text-default">Appointments awaiting outcome</h2>
        {awaiting.length > 0 && (
          <span className="rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption font-semibold text-text-default">
            {total} total
          </span>
        )}
      </div>

      {awaiting.length === 0 ? (
        <p className="text-body-sm text-text-muted">
          Everyone is caught up. No appointments are waiting on an outcome.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {awaiting.map((r) => (
            <li
              key={r.userId}
              className="flex items-center justify-between gap-3 rounded-radius-sm bg-surface-sunken px-3 py-2"
            >
              <span className="truncate text-label text-text-default">{r.fullName ?? "Unknown"}</span>
              <span className="rounded-radius-full bg-surface-default px-2 py-0.5 text-caption font-semibold text-text-default">
                {r.awaitingCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default AppointmentsAwaitingCard;
