/**
 * TeamCoverageCard — SP2b manager/admin rollup on the Team page. Team headline
 * (volume-weighted composite + band + "N of M reps with data") via the pure
 * teamCoverage(), plus a per-rep coverage chip ("No data" for null/insufficient).
 * Scores only — never raw signals. Data-quality framing, never compliance.
 */
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { useCoverageRollup } from "../hooks/useCoverageRollup";
import { teamCoverage, isGradeable, type CoverageRollupRow } from "../lib/teamCoverage";
import { bandPresentation } from "../lib/bandPresentation";
import { band } from "../../../../../../supabase/functions/_shared/coverage/score";
import { DEFAULT_COVERAGE_CONFIG } from "../../../../../../supabase/functions/_shared/coverage/config";

function RepChip({ r }: { r: CoverageRollupRow }) {
  if (!isGradeable(r) || r.compositeCoverage === null) {
    return (
      <span className="rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption text-text-subtle">
        No data
      </span>
    );
  }
  const pres = bandPresentation(band(r.compositeCoverage, DEFAULT_COVERAGE_CONFIG.bandThresholds));
  return (
    <span className={cn("rounded-radius-full px-2 py-0.5 text-caption font-semibold", pres.pillClass)}>
      {pres.label} {Math.round(r.compositeCoverage * 100)}%
    </span>
  );
}

export function TeamCoverageCard() {
  const { rows } = useCoverageRollup();
  if (rows.length === 0) return null;

  const team = teamCoverage(rows);
  const headline =
    team.band !== null && team.compositeCoverage !== null ? bandPresentation(team.band) : null;

  return (
    <Card padding="lg" shadow="sm" className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-heading-sm text-text-default">Team logging coverage</h2>
        {headline && (
          <span className={cn("rounded-radius-full px-2 py-0.5 text-caption font-semibold", headline.pillClass)}>
            {headline.label} · {Math.round((team.compositeCoverage as number) * 100)}%
          </span>
        )}
      </div>

      {headline ? (
        <p className="mb-3 text-body-sm text-text-muted">
          Based on {team.repsWithData} of {team.repsTotal} reps with coverage data.
        </p>
      ) : (
        <p className="mb-3 text-body-sm text-text-muted">
          No team coverage data yet — coverage appears as your reps log calls through tap-to-call.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.userId}
            className="flex items-center justify-between gap-3 rounded-radius-sm bg-surface-sunken px-3 py-2"
          >
            <span className="truncate text-label text-text-default">{r.fullName ?? "Unknown"}</span>
            <RepChip r={r} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
