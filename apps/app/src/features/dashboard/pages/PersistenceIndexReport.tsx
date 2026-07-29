/**
 * Persistence Index: history detail page (Slice 3-5). Client-side daily
 * trend over a selectable range, with a volume sub-chart, benchmark
 * reference lines (peer average + top decile/performer where available),
 * a sub-component breakdown card, and a "this period" stats grid. Rep sees
 * their own series; manager/admin sees the team median. The daily company
 * average / top decile reference lines come from the SP-B nightly snapshot
 * pipeline (usePersistenceCompanySeries), falling back to the static SP-A
 * benchmark until enough snapshots accrue.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { useProfile } from "@/features/auth/useProfile";
import { usePersistenceHistory } from "../hooks/usePersistenceHistory";
import { usePerRepPersistence } from "../hooks/usePerRepPersistence";
import { useOrgMemberNames } from "@/features/dashboard/hooks/useOrgMemberNames";
import { usePersistenceBenchmarks } from "../hooks/usePersistenceBenchmarks";
import { usePersistenceCompanySeries } from "../hooks/usePersistenceCompanySeries";
import { usePersistenceIndex } from "../hooks/usePersistenceIndex";
import { useTeamPersistenceIndex } from "../hooks/useTeamPersistenceIndex";
import { useCoverageRollup } from "@/features/coverage/hooks/useCoverageRollup";
import {
  RANGE_PRESETS,
  TARGET_SCORE,
  FOLLOWUP_MAX,
  CADENCE_MAX,
  REENGAGEMENT_MAX,
  historyDelta,
  persistenceStats,
  coverageGateState,
  type RangeKey,
} from "../lib/persistenceIndex";
import { PersistenceSubComponents } from "../components/PersistenceSubComponents";
import { PersistenceStatsGrid } from "../components/PersistenceStatsGrid";
import { DirectReportsTable } from "../components/DirectReportsTable";
import { useDirectReports } from "../hooks/useDirectReports";
import { useAllRepsHistory } from "../hooks/useAllRepsHistory";

/** Point path (no fill), broken into `M`/`L` commands. */
function buildLine(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/** Line path plus its area-fill path (same points, closed down to the baseline). */
function buildLineAndArea(pts: { x: number; y: number }[], baselineY: number): { line: string; area: string } {
  const line = buildLine(pts);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `${line} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;
  return { line, area };
}

/**
 * Per-date reference series (e.g. the daily company average / top decile
 * lines) plotted with the same x/y scale as the main composite line, broken
 * into segments across null gaps (days with no snapshot yet).
 */
function buildDailyLineSegments(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string[] {
  const segments: string[] = [];
  let curPts: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (curPts.length > 1) segments.push(buildLine(curPts));
      curPts = [];
      return;
    }
    curPts.push({ x: x(i), y: y(v) });
  });
  if (curPts.length > 1) segments.push(buildLine(curPts));
  return segments;
}

function TrendChart({
  points,
  referenceLines,
  dailyReferenceLines,
  overlaySeries,
}: {
  points: { composite: number | null; date?: string }[];
  referenceLines: { value: number; label: string }[];
  /**
   * Daily company-wide reference lines (SP-B), one polyline per series
   * aligned to `points` by index. Takes precedence over the flat
   * `referenceLines` when present (the SP-A static benchmark is the
   * accrual-period fallback, passed via `referenceLines` instead).
   */
  dailyReferenceLines?: { label: string; values: (number | null)[] }[];
  /** Faint per-rep overlay lines ("All reps" toggle), aligned to `points` by
   *  index. Each entry is a rep's daily composite values. */
  overlaySeries?: (number | null)[][];
}) {
  const W = 640;
  const H = 180;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

  // Hover crosshair + tooltip: map the pointer's x within the chart to the
  // nearest data index. The SVG stretches (preserveAspectRatio none), so we
  // map from the container's pixel width, not the viewBox.
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el || n <= 1) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (n - 1)));
  };
  const hoverPoint = hover != null ? points[hover] : null;
  const hoverFrac = hover != null && n > 1 ? hover / (n - 1) : 0;
  const hoverDate =
    hoverPoint?.date != null
      ? new Date(hoverPoint.date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : null;

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

  const dailySegments = (dailyReferenceLines ?? []).map((dl) => ({
    label: dl.label,
    segments: buildDailyLineSegments(dl.values, x, y),
  }));

  const overlaySegments = (overlaySeries ?? []).map((values) => buildDailyLineSegments(values, x, y));

  return (
    <div ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Persistence index trend"
      >
      {dailyReferenceLines && dailyReferenceLines.length > 0
        ? dailySegments.map((dl, di) =>
            dl.segments.map((d, si) => (
              <path
                key={`daily-${di}-${si}`}
                d={d}
                data-reference-label={dl.label}
                fill="none"
                stroke="currentColor"
                strokeDasharray="4 4"
                className="text-border-strong"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )),
          )
        : referenceLines.map((r, i) => (
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
      {/* Faint per-rep overlay lines, behind the composite + areas. */}
      {overlaySegments.map((segs, ri) =>
        segs.map((d, si) => (
          <path
            key={`overlay-${ri}-${si}`}
            d={d}
            data-testid="rep-overlay-line"
            fill="none"
            stroke="currentColor"
            className="text-border-strong"
            strokeWidth={1}
            strokeOpacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
      {areas.map((d, i) => (
        <path key={`area-${i}`} d={d} stroke="none" fill="#2E5FE2" fillOpacity={0.08} />
      ))}
      {lines.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="#2E5FE2"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {hoverPoint && hoverPoint.composite != null && (
        <line
          x1={x(hover ?? 0)}
          y1={0}
          x2={x(hover ?? 0)}
          y2={H}
          stroke="#2E5FE2"
          strokeOpacity={0.4}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      </svg>
      {hoverPoint && hoverPoint.composite != null && (
        <div
          data-testid="trend-tooltip"
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-radius-sm border border-border-subtle bg-surface-default px-2 py-1 text-caption shadow-card-hover"
          style={{ left: `${hoverFrac * 100}%` }}
        >
          <span className="tabular-nums text-text-default">{hoverPoint.composite}</span>
          {hoverDate && <span className="text-text-subtle"> · {hoverDate}</span>}
        </div>
      )}
    </div>
  );
}

/** Mean activity across the days that had any activity (the "typical" day). */
export function busyDayThreshold(counts: number[]): number {
  const active = counts.filter((c) => c > 0);
  if (active.length === 0) return 0;
  return active.reduce((a, b) => a + b, 0) / active.length;
}

function VolumeChart({ points }: { points: { activityCount: number }[] }) {
  const counts = points.map((p) => p.activityCount);
  const max = Math.max(1, ...counts);
  const threshold = busyDayThreshold(counts);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-12 items-end gap-px" aria-hidden>
        {points.map((p, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-t-radius-sm",
              p.activityCount > 0 && p.activityCount >= threshold ? "bg-accent-teal" : "bg-accent-orange",
            )}
            style={{ height: `${(p.activityCount / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-caption text-text-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" aria-hidden /> Busier day
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-orange" aria-hidden /> Lighter day
        </span>
      </div>
    </div>
  );
}

/** A legend pill that toggles a chart series on/off. */
function LegendToggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-radius-full border px-2.5 py-1 text-caption transition-colors",
        on ? "border-brand-primary text-text-default" : "border-border-subtle text-text-subtle",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-text-muted" : "bg-border-strong")} aria-hidden />
      {label}
    </button>
  );
}

export function PersistenceIndexReport() {
  const navigate = useNavigate();
  const role = useProfile().data?.role;
  const isManager = role === "manager" || role === "admin";
  const [rangeKey, setRangeKey] = React.useState<RangeKey>("1M");
  const [selectedRep, setSelectedRep] = React.useState<string | null>(null);
  // Chart legend toggles (prototype): benchmark lines default on, all-reps
  // overlay default off.
  const [showAvg, setShowAvg] = React.useState(true);
  const [showTop, setShowTop] = React.useState(true);
  const [showAllReps, setShowAllReps] = React.useState(false);
  const rangeDays = RANGE_PRESETS.find((r) => r.key === rangeKey)!.days;
  const points = usePersistenceHistory(rangeDays, selectedRep ?? undefined);
  const roster = usePerRepPersistence();
  const names = useOrgMemberNames(isManager);
  const own = usePersistenceIndex();
  const team = useTeamPersistenceIndex();
  const bench = usePersistenceBenchmarks();
  const directReports = useDirectReports(isManager);
  const overlaySeries = useAllRepsHistory(rangeDays, isManager && !selectedRep && showAllReps);
  // Reps never render peer benchmarks (strategy "solo"), so skip the RPC for them.
  const companySeriesQuery = usePersistenceCompanySeries(rangeDays, bench.strategy !== "solo");
  const companySeries = companySeriesQuery.data ?? [];
  // Logging Coverage gate (beta default, flagged for Robert): applied only to
  // the selected-rep drill-down, never the team aggregate. The hook is
  // manager/admin only, matching this manager-only page; an RPC error (or a
  // rep hitting it) returns an empty rollup, so the gate resolves to "none"
  // rather than blocking the page.
  const coverageRollup = useCoverageRollup();
  const coverageByUser = React.useMemo(
    () => new Map(coverageRollup.rows.map((r) => [r.userId, r.compositeCoverage] as const)),
    [coverageRollup.rows],
  );
  const selectedCoverage = selectedRep ? coverageByUser.get(selectedRep) ?? null : null;
  const coverageGate = selectedRep ? coverageGateState(selectedCoverage) : "none";
  const coverageSuppressed = coverageGate === "suppress";

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
  const subReEngagement = selectedRep
    ? selectedRow?.reEngagementPoints ?? null
    : isManager
      ? team.reEngagement.points
      : own?.reEngagement.hasSample ? own.reEngagement.points : null;
  // Mirrors the selectedRep -> team -> own resolution above. The team composite
  // is a median across reps and doesn't carry a single below-floor state, so a
  // team-level caveat is out of scope for SP-A (always false in that branch).
  const followUpBelowFloor = selectedRep
    ? selectedRow?.followUpBelowFloor ?? false
    : isManager
      ? false
      : own?.caveats.followUpBelowFloor ?? false;
  // Eligible/recovered counts for the re-engagement row (addendum). Mirrors
  // the same selectedRep -> team -> own resolution as the points above. Only
  // renders once both counts resolve to real numbers (guards older/mocked
  // result shapes that predate these fields from leaking "undefined" text).
  const rawReEngagementCounts = selectedRep
    ? selectedRow
      ? { silentCount: selectedRow.reEngagementSilentCount, reEngagedCount: selectedRow.reEngagementReEngagedCount }
      : null
    : isManager
      ? { silentCount: team.reEngagement.silentCount, reEngagedCount: team.reEngagement.reEngagedCount }
      : own?.reEngagement.hasSample
        ? { silentCount: own.reEngagement.silentCount, reEngagedCount: own.reEngagement.reEngagedCount }
        : null;
  const subReEngagementCounts =
    rawReEngagementCounts &&
    typeof rawReEngagementCounts.silentCount === "number" &&
    typeof rawReEngagementCounts.reEngagedCount === "number"
      ? { silentCount: rawReEngagementCounts.silentCount, reEngagedCount: rawReEngagementCounts.reEngagedCount }
      : null;
  // Below the follow-up volume floor, the composite is null (addendum 4.3):
  // show the partial cadence+re-engagement score out of 60 instead of
  // rescaling to 100. Never true for the team-aggregate branch above.
  const showBelowFloorScore = followUpBelowFloor;
  const belowFloorTotal = (subCadence ?? 0) + (subReEngagement ?? 0);
  const belowFloorMax = CADENCE_MAX + REENGAGEMENT_MAX;
  const showBenchmarks = bench.strategy !== "solo";
  const topLabel = bench.strategy === "top-performer" ? "Top performer" : "Top 10%";
  const topValue = bench.topDecile ?? bench.topPerformer;
  const referenceLines = showBenchmarks
    ? [{ value: bench.peerAvg as number, label: bench.avgLabel }, ...(topValue != null ? [{ value: topValue, label: topLabel }] : [])]
    : [{ value: TARGET_SCORE, label: "Target" }];
  const stats = persistenceStats(points, bench.peerAvg);

  // SP-B: once at least 2 dated nightly snapshots have accrued, replace the
  // flat SP-A static benchmark with real daily company-wide reference lines
  // (a beta simplification vs SP-A's team-scoped static benchmark, since the
  // snapshot pipeline aggregates at the org level, not per-team).
  const useDailyLines = showBenchmarks && companySeries.filter((p) => p.median != null).length >= 2;
  const dateToIndex = React.useMemo(() => new Map(points.map((p, i) => [p.date, i] as const)), [points]);
  const dailyMedianValues = React.useMemo(() => {
    const arr: (number | null)[] = new Array(points.length).fill(null);
    companySeries.forEach((row) => {
      const idx = dateToIndex.get(row.date);
      if (idx != null) arr[idx] = row.median;
    });
    return arr;
  }, [companySeries, dateToIndex, points.length]);
  const dailyP90Values = React.useMemo(() => {
    const arr: (number | null)[] = new Array(points.length).fill(null);
    companySeries.forEach((row) => {
      const idx = dateToIndex.get(row.date);
      if (idx != null) arr[idx] = row.p90;
    });
    return arr;
  }, [companySeries, dateToIndex, points.length]);
  const dailyReferenceLines = useDailyLines
    ? [
        { label: "Company average", values: dailyMedianValues },
        { label: "Top decile", values: dailyP90Values },
      ]
    : undefined;
  // Apply the legend toggles: hide the average / top-decile lines when their
  // toggle is off. "Company average" gates on showAvg; top decile/performer on
  // showTop; anything else (e.g. the solo "Target" line) always shows.
  const isAvgLabel = (label: string) => label === "Company average" || label === bench.avgLabel;
  const isTopLabel = (label: string) =>
    label === "Top decile" || label === "Top performer" || label === "Top 10%";
  const gatedDailyReferenceLines = dailyReferenceLines?.filter((dl) =>
    isAvgLabel(dl.label) ? showAvg : isTopLabel(dl.label) ? showTop : true,
  );
  const gatedReferenceLines = referenceLines.filter((r) =>
    isAvgLabel(r.label) ? showAvg : isTopLabel(r.label) ? showTop : true,
  );
  // Toggle labels reflect the actual benchmark: the SP-B daily lines are
  // company-wide ("Company average" / "Top decile"); the SP-A fallback uses the
  // tenant strategy's labels (e.g. "Team average" / "Top 10%").
  const avgLegendLabel = useDailyLines ? "Company average" : bench.avgLabel;
  const topLegendLabel = useDailyLines ? "Top decile" : topLabel;

  // Manager-only for beta (addendum 4.2): the widget is hidden for reps, and
  // the detail page is guarded here too so a rep cannot reach their own score
  // by opening the URL directly. Revisit before the rep-facing view is enabled.
  if (!isManager) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex w-fit items-center gap-1 text-body-sm text-text-muted hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
          </button>
          <Card padding="lg" shadow="sm">
            <p className="text-body-sm text-text-muted">
              The Persistence Index is available to managers during the beta.
            </p>
          </Card>
        </div>
      </div>
    );
  }

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
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-caption uppercase tracking-wide text-text-subtle">
              navigatr · Persistence Index
            </span>
            <span className="text-caption uppercase tracking-wide text-text-subtle">
              As of{" "}
              {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          </div>
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
            {coverageSuppressed ? (
              <p className="text-body-sm text-text-muted">Not enough logging to score yet.</p>
            ) : current == null && !showBelowFloorScore ? (
              <p className="text-body-sm text-text-muted">Not enough data yet to chart a trend.</p>
            ) : (
              <>
                <div className="flex items-end gap-3">
                  {showBelowFloorScore ? (
                    <>
                      <span className="text-kpi-lg tabular-nums leading-none text-text-default">{belowFloorTotal}</span>
                      <span className="pb-1 text-caption text-text-muted">/ {belowFloorMax} · cadence + re-engagement only</span>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>

                {coverageGate === "caveat" && (
                  <p className="text-caption text-status-warning">
                    Logging coverage is low ({Math.round((selectedCoverage as number) * 100)}%); this score may be incomplete.
                  </p>
                )}

                <div className="inline-flex w-fit rounded-radius-md border border-border-subtle p-0.5 text-caption">
                  {RANGE_PRESETS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setRangeKey(r.key)}
                      aria-pressed={rangeKey === r.key}
                      className={cn(
                        "rounded-radius-sm px-3 py-1 transition-colors",
                        rangeKey === r.key
                          ? "bg-brand-primary text-brand-primary-foreground"
                          : "text-text-muted hover:text-text-default",
                      )}
                    >
                      {r.key}
                    </button>
                  ))}
                </div>

                <div className="text-brand-primary">
                  <TrendChart
                    points={points}
                    referenceLines={gatedReferenceLines}
                    dailyReferenceLines={gatedDailyReferenceLines}
                    overlaySeries={overlaySeries.map((s) => s.values)}
                  />
                </div>
                {!showBelowFloorScore && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-caption text-text-muted">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#2E5FE2" }} aria-hidden />
                      {selectedRep ? "Rep" : "Team"}
                      {current != null ? ` ${current}` : ""}
                    </span>
                    {showBenchmarks && (
                      <>
                        <LegendToggle label={avgLegendLabel} on={showAvg} onToggle={() => setShowAvg((v) => !v)} />
                        <LegendToggle label={topLegendLabel} on={showTop} onToggle={() => setShowTop((v) => !v)} />
                      </>
                    )}
                    {!selectedRep && (
                      <LegendToggle label="All reps" on={showAllReps} onToggle={() => setShowAllReps((v) => !v)} />
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

        {/* Sub-component breakdown + this-period stats live in the per-rep
            drill-down only (the team view is the rollup chart + reps table,
            matching the prototype). */}
        {selectedRep && (current != null || showBelowFloorScore) && !coverageSuppressed && (
          <>
            <PersistenceSubComponents
              rows={[
                { key: "followUp", label: "Follow-up discipline", points: subFollowUp, max: FOLLOWUP_MAX, peerPct: showBenchmarks ? bench.followUpAvgPct : null },
                { key: "cadence", label: "Touch cadence", points: subCadence, max: CADENCE_MAX, peerPct: showBenchmarks ? bench.cadenceAvgPct : null },
                { key: "reEngagement", label: "Re-engagement after silence", points: subReEngagement, max: REENGAGEMENT_MAX, peerPct: showBenchmarks ? bench.reEngagementAvgPct : null, counts: subReEngagementCounts },
              ]}
              footnote={followUpBelowFloor ? "Follow-up volume too low to score discipline; showing cadence and re-engagement only." : undefined}
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

        {!selectedRep && <DirectReportsTable rows={directReports} onSelect={setSelectedRep} />}
      </div>
    </div>
  );
}

export default PersistenceIndexReport;
