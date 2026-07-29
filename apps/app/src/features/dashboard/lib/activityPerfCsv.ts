/**
 * CSV for the Activity-To-Win report: one row per deal ("company") in the
 * active scope, richest-value first. Reuses the formula-injection-safe escaper.
 */
import type { DealPerf } from "./activityPerformance";
import type { ReportScope } from "./unifiedActivityReport";
import { escapeCsvCell } from "./repCompanyCsv";
import { formatBandUsd } from "./activityToWin";

const HEADER = ["Company", "Rep", "Outcome", "Value", "Calls", "Emails", "Visits", "Appointments", "Total", "Days"];

export function activityPerfCsv(
  rows: DealPerf[],
  scope: ReportScope,
  nameOf: (ownerId: string | null) => string,
): string {
  const scoped = scope === "all" ? rows : rows.filter((r) => r.outcome === scope);
  const sorted = [...scoped].sort((a, b) => b.valueCents - a.valueCents);
  const lines = [HEADER.join(",")];
  for (const r of sorted) {
    lines.push(
      [
        escapeCsvCell(r.companyName),
        escapeCsvCell(nameOf(r.ownerId)),
        r.outcome,
        escapeCsvCell(formatBandUsd(r.valueCents)),
        r.counts.call,
        r.counts.email,
        r.counts.drop_in,
        r.counts.appointment,
        r.counts.total,
        r.days ?? "",
      ]
        .map(String)
        .join(","),
    );
  }
  return lines.join("\n");
}
