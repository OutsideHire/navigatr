/**
 * TieredStopList (SP-C2) - the shared presentational surface that renders the
 * rep's day as ONE ordered, clearly-tiered, actionable list. Each row carries
 * its tier chip (reusing the shared tierStyles), an optional appointment time,
 * an optional past-due age, and a caller-supplied action node. It is purely
 * presentational: it owns row chrome (badge, name, chip, time, age, dim /
 * strike treatment) and renders whatever actions the parent hands it, so both
 * the Stops tab (ActivePathView) and the SP-C3 Run view can reuse it without
 * baking either surface's actions into the component.
 *
 * Rows arrive already ordered (appointments, then past-due, due-today, nearby);
 * this component does not sort.
 */
import * as React from "react";
import { CalendarClock, MapPin } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StopTier } from "../lib/todaysPath";
import { tierAccent, tierChipLabel } from "../lib/tierStyles";

export interface TieredStopRow {
  /** Stable React key. */
  key: string;
  tier: StopTier;
  /** External calendar appointment - switches the chip label to "From calendar". */
  external?: boolean;
  /** Primary label (appointment title or stop / deal name). */
  name: string;
  /** Secondary content under the name (deal name, category · address, leg line). */
  detail?: React.ReactNode;
  /** Appointment clock time, right-aligned next to the name. */
  timeLabel?: string;
  /** Past-due staleness; renders "Nd overdue" beside the chip. */
  ageDays?: number | null;
  /** 1-based number shown in the default badge for numbered stops. When omitted
   *  (and no `badge` override), the tier icon shows instead. */
  index?: number;
  /** Full badge node replacing the default tier circle (native stops pass their
   *  status-colored badge here). */
  badge?: React.ReactNode;
  /** Chip label override (e.g. "Ended" for a past appointment). */
  chipOverride?: string;
  /** One plain reason sentence (spec 6.1). When present, the row shows this
   *  instead of the tier chip + overdue age. */
  reason?: string;
  /** Warning-color the reason line (a place is aging). Colour is the only signal. */
  aging?: boolean;
  /** Dim the whole row (past / resolved). */
  dimmed?: boolean;
  /** Strike the name (past / resolved). */
  strikethrough?: boolean;
  /** Rendered action buttons for this row. */
  actions?: React.ReactNode;
}

function DefaultBadge({ row, accent }: { row: TieredStopRow; accent: ReturnType<typeof tierAccent> }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold tabular-nums",
        accent.icon,
      )}
      aria-hidden
    >
      {row.tier === "appointment" ? (
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
      ) : row.index != null ? (
        row.index
      ) : (
        <MapPin className="h-3.5 w-3.5" aria-hidden />
      )}
    </span>
  );
}

function Row({ row }: { row: TieredStopRow }) {
  const accent = tierAccent(row.tier);
  const isAppointment = row.tier === "appointment";

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-radius-md border p-3",
        isAppointment ? accent.border : "border-border-subtle bg-surface-default",
        row.dimmed && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        {row.badge ?? <DefaultBadge row={row} accent={accent} />}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={cn(
                "truncate text-body-strong text-text-default",
                row.strikethrough && "line-through",
              )}
            >
              {row.name}
            </p>
            {row.timeLabel && (
              <span className="shrink-0 text-caption tabular-nums text-accent-violet">
                {row.timeLabel}
              </span>
            )}
          </div>

          {row.detail != null && (
            <div className="mt-0.5 text-caption text-text-muted">{row.detail}</div>
          )}

          {row.reason != null ? (
            <p
              className={cn(
                "mt-0.5 text-caption",
                row.aging ? "text-status-warning" : "text-text-muted",
              )}
            >
              {row.reason}
            </p>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center rounded-radius-full px-2 py-0.5 text-caption font-medium",
                  accent.chip,
                )}
              >
                {row.chipOverride ?? tierChipLabel(row.tier, { external: row.external })}
              </span>
              {row.tier === "past_due" && row.ageDays != null && (
                <span className="text-caption font-medium text-status-warning tabular-nums">
                  {row.ageDays}d overdue
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {row.actions && (
        <div className="flex flex-wrap items-center gap-1.5 pl-10">{row.actions}</div>
      )}
    </li>
  );
}

export function TieredStopList({ rows }: { rows: TieredStopRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </ol>
  );
}

export default TieredStopList;
