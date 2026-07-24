/**
 * Persistence Index: history detail page (Slice 3-5). Client-side daily
 * trend over a selectable range, with a volume sub-chart, benchmark
 * reference lines (peer average + top decile/performer where available),
 * a sub-component breakdown card, and a "this period" stats grid. Rep sees
 * their own series; manager/admin sees the team median. The server-snapshot
 * pipeline is a later slice.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { usePersistenceHistory } from "../hooks/usePersistenceHistory";
import { usePerRepPersistence } from "../hooks/usePerRepPersistence";
import { useOrgMemberNames } from "@/features/dashboard/hooks/useOrgMemberNames";
import { usePersistenceBenchmarks } from "../hooks/usePersistenceBenchmarks";
import { usePersistenceIndex } from "../hooks/usePersistenceIndex";
import { useTeamPersistenceIndex } from "../hooks/useTeamPersistenceIndex";
import {
  RANGE_PRESETS,
  TARGET_SCORE,
  historyDelta,
  persistenceStats,
  type RangeKey,
  type PerRepScore,
} from "../lib/persistenceIndex";
import { PersistenceSubComponents } from "../components/PersistenceSubComponents";
import { PersistenceStatsGrid } from "../components/PersistenceStatsGrid";

/** Line path plus its area-fill path (same points, closed down to the baseline). */
function buildLineAndArea(pts: { x: number; y: number }[], baselineY: number): { line: string; area: string } {
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `${line} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;
  return { line, area };
}

function TrendChart({
  points,
  referenceLines,
}: {
  points: { composite: number | null }[];
  referenceLines: { value: number; label: string }[];
}) {
  const W = 640;
  const H = 180;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

  // Build line + area segments, breaking on null gaps.
  const lines: string[] = [];
  const areas: string[] = [];
  let curPts: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.composite == null) {
      if (curPts.length) {
        const { line, area } = buildLineAndArea(curPts, H);
        lines.push(line);
        areas.push(area);
        curPts = [];
      }
      return;
    }
    curPts.push({ x: x(i), y: y(p.composite) });
  });
  if (curPts.length) {
    const { line, area } = buildLineAndArea(curPts, H);
    lines.push(line);
    areas.push(area);
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-44 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Persistence index trend"
    >
      {referenceLines.map((r, i) => (
        <line
          key={i}
          x1={0}
          y1={y(r.value)}
          x2={W}
          y2={y(r.value)}
          stroke="currentColor"
          strokeDasharray="4 4"
          className="text-border-strong"
          strokeWidth={1}
        />
      ))}
      {areas.map((d, i) => (
        <path key={`area-${i}`} d={d} stroke="none" fill="currentColor" fillOpacity={0.08} className="text-brand-primary" />
      ))}
      {lines.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="currentColor"
          className="text-brand-primary"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function VolumeChart({ points }: { points: { activityCount: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.activityCount));
  return (
    <div className="flex h-12 items-end gap-px" aria-hidden>
      {points.map((p, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-radius-sm bg-surface-sunken"
          style={{ height: `${(p.activityCount / max) * 100}%` }}
        />
      ))}
    </div>
  );
}

function RepRoster({
  rows,
  names,
  onSelect,
}: {
  rows: PerRepScore[];
  names: Map<string, string>;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-3">
        <span className="text-body-sm font-medium text-text-default">By rep</span>
        <div className="flex flex-col divide-y divide-border-subtle">
          {rows.map((r) => (
            <button
              key={r.ownerId}
              type="button"
              onClick={() => onSelect(r.ownerId)}
              className="flex items-center gap-3 py-2 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              <span className="flex-1 truncate text-body-sm text-text-default">
                {names.get(r.ownerId) ?? "Unknown rep"}
              </span>
              {r.composite == null ? (
                <span className="text-caption text-text-subtle">no data yet</span>
              ) : (
                <>
                  <div className="h-1.5 w-24 overflow-hidden rounded-radius-full bg-surface-sunken">
                    <div className="h-full rounded-radius-full bg-brand-primary" style={{ width: `${r.composite}%` }} />
                  </div>
                  <span className="w-8 text-right text-body-sm tabular-nums text-text-default">{r.composite}</span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function PersistenceIndexReport() {
  const navigate = useNavigate();
  const role = useProfile().data?.role;
  const isManager = role === "manager" || role === "admin";
  const [rangeKey, setRangeKey] = React.useState<RangeKey>("1M");
  const [selectedRep, setSelectedRep] = React.useState<string | null>(null);
  const rangeDays = RANGE_PRESETS.find((r) => r.key === rangeKey)!.days;
  const points = usePersistenceHistory(rangeDays, selectedRep ?? undefined);
  const roster = usePerRepPersistence();
  const names = useOrgMemberNames(isManager);
  const own = usePersistenceIndex();
  const team = useTeamPersistenceIndex();
  const bench = usePersistenceBenchmarks();

  const scored = points.filter((p) => p.composite != null);
  const current = scored.length ? (scored[scored.length - 1].composite as number) : null;
  const delta = historyDelta(points);

  const selectedRow = selectedRep ? roster.find((r) => r.ownerId === selectedRep) ?? null : null;
  const subFollowUp = selectedRep
    ? selectedRow?.followUpPoints ?? null
    : isManager
      ? team.followUp.points
      : own?.followUp.hasSample ? own.followUp.points : null;
  const subCadence = selectedRep
    ? selectedRow?.cadencePoints ?? null
    : isManager
      ? team.cadence.points
      : own?.cadence.hasSample ? own.cadence.points : null;
  const showBenchmarks = bench.strategy !== "solo";
  const topLabel = bench.strategy === "top-performer" ? "Top performer" : "Top 10%";
  const topValue = bench.topDecile ?? bench.topPerformer;
  const referenceLines = showBenchmarks
    ? [{ value: bench.peerAvg as number, label: bench.avgLabel }, ...(topValue != null ? [{ value: topValue, label: topLabel }] : [])]
    : [{ value: TARGET_SCORE, label: "Target" }];
  const stats = persistenceStats(points, bench.peerAvg);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex w-fit items-center gap-1 text-body-sm text-text-muted hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
          </button>
          <h1 className="text-heading-md text-text-default">Persistence index</h1>
          {selectedRep ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body-sm text-text-muted">{names.get(selectedRep) ?? "Rep"} · trailing 30-day score</p>
              <button
                type="button"
                onClick={() => setSelectedRep(null)}
                className="text-body-sm text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                Back to team
              </button>
            </div>
          ) : (
            <p className="text-body-sm text-text-muted">{isManager ? "Your team" : "You"} · trailing 30-day score</p>
          )}
        </div>

        <Card padding="lg" shadow="sm">
          <div className="flex flex-col gap-4">
            {current == null ? (
              <p className="text-body-sm text-text-muted">Not enough data yet to chart a trend.</p>
            ) : (
              <>
                <div className="flex items-end gap-3">
                  <span className="text-kpi-lg tabular-nums leading-none text-text-default">{current}</span>
                  <span className="pb-1 text-caption text-text-muted">/ 100 · target {TARGET_SCORE}</span>
                  {delta != null && delta !== 0 && (
                    <span
                      className={`inline-flex items-center pb-1 text-caption ${delta > 0 ? "text-status-success" : "text-status-danger"}`}
                    >
                      {delta > 0 ? (
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {Math.abs(delta)} this period
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {RANGE_PRESETS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setRangeKey(r.key)}
                      className={`rounded-radius-full px-3 py-1 text-caption ${
                        rangeKey === r.key
                          ? "bg-brand-primary text-brand-primary-foreground"
                          : "bg-surface-sunken text-text-muted hover:text-text-default"
                      }`}
                    >
                      {r.key}
                    </button>
                  ))}
                </div>

                <div className="text-brand-primary">
                  <TrendChart points={points} referenceLines={referenceLines} />
                </div>
                {showBenchmarks && (
                  <div className="flex flex-wrap items-center gap-3 text-caption text-text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden /> You {current}
                    </span>
                    {bench.peerAvg != null && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-text-muted" aria-hidden /> {bench.avgLabel} {bench.peerAvg}
                      </span>
                    )}
                    {topValue != null && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-text-muted" aria-hidden /> {topLabel} {topValue}
                      </span>
                    )}
                  </div>
                )}
                <VolumeChart points={points} />
                <p className="text-caption text-text-subtle">
                  Daily score (trailing 30-day window) · bars show activity logged per day.
                </p>
              </>
            )}
          </div>
        </Card>

        {current != null && (
          <>
            <PersistenceSubComponents
              followUpPoints={subFollowUp}
              cadencePoints={subCadence}
              peerFollowUpPct={showBenchmarks ? bench.followUpAvgPct : null}
              peerCadencePct={showBenchmarks ? bench.cadenceAvgPct : null}
            />
            <PersistenceStatsGrid
              stats={stats}
              peerAvg={bench.peerAvg}
              topLabel={topLabel}
              topValue={topValue}
              showBenchmarks={showBenchmarks}
            />
          </>
        )}

        {isManager && !selectedRep && <RepRoster rows={roster} names={names} onSelect={setSelectedRep} />}
      </div>
    </div>
  );
}

export default PersistenceIndexReport;
