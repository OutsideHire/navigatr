/**
 * CSV for the unified report: one row per rep x company for the active scope.
 * Reuses the formula-injection-safe escaper from the rep-company report.
 */
import type { UnifiedRepRow } from "./unifiedActivityReport";
import { escapeCsvCell } from "./repCompanyCsv";
import { formatBandUsd } from "./activityToWin";

const HEADER = ["Rep", "Company", "Calls", "Emails", "Visits", "Appointments", "Total", "Deals", "Value"];

export function unifiedActivityCsv(reps: UnifiedRepRow[], nameOf: (ownerId: string | null) => string): string {
  const lines = [HEADER.join(",")];
  for (const rep of reps) {
    const name = nameOf(rep.ownerId);
    for (const c of rep.companies) {
      lines.push([
        escapeCsvCell(name), escapeCsvCell(c.companyName),
        c.counts.call, c.counts.email, c.counts.drop_in, c.counts.appointment, c.counts.total,
        c.dealCount, escapeCsvCell(formatBandUsd(c.valueCents)),
      ].map(String).join(","));
    }
  }
  return lines.join("\n");
}
