/**
 * SeatUsageBadge — shows "X / Y seats" with a progress bar. Lives in
 * the AgentsPage header.
 */
import { useSeatUsage } from "../hooks/useSeatUsage";

export function SeatUsageBadge() {
  const { data, isLoading } = useSeatUsage();
  if (isLoading || !data) return null;

  const { used, limit } = data;
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const text = limit === null ? `${used} seats used` : `${used} / ${limit}`;

  return (
    <div className="flex items-center gap-3">
      <span className="text-caption text-text-muted">Seats:</span>
      <span className="text-body-strong tabular-nums">{text}</span>
      {limit !== null && (
        <div className="h-2 w-32 overflow-hidden rounded-radius-full bg-surface-sunken">
          <div
            className={pct >= 90 ? "h-full bg-status-danger" : "h-full bg-brand-primary"}
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
