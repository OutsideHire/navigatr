/**
 * Persistence Index — history detail page (Slice 3). Client-side daily trend
 * over a selectable range, with a volume sub-chart and a target reference
 * line. Rep sees their own series; manager/admin sees the team median.
 * True peer-benchmark reference lines + the server-snapshot pipeline are a
 * later slice.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { usePersistenceHistory } from "../hooks/usePersistenceHistory";
import { RANGE_PRESETS, TARGET_SCORE, historyDelta, type RangeKey } from "../lib/persistenceIndex";

function TrendChart({ points }: { points: { composite: number | null }[] }) {
  const W = 640;
  const H = 180;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

  // Build line segments, breaking on null gaps.
  const segments: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.composite == null) {
      if (cur.length) {
        segments.push(cur.join(" "));
        cur = [];
      }
      return;
    }
    cur.push(`${cur.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.composite).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(" "));

  const targetY = y(TARGET_SCORE);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-44 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Persistence index trend"
    >
      <line
        x1={0}
        y1={targetY}
        x2={W}
        y2={targetY}
        stroke="currentColor"
        strokeDasharray="4 4"
        className="text-border-strong"
        strokeWidth={1}
      />
      {segments.map((d, i) => (
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

export function PersistenceIndexReport() {
  const navigate = useNavigate();
  const role = useProfile().data?.role;
  const isTeam = role === "manager" || role === "admin";
  const [rangeKey, setRangeKey] = React.useState<RangeKey>("1M");
  const rangeDays = RANGE_PRESETS.find((r) => r.key === rangeKey)!.days;
  const points = usePersistenceHistory(rangeDays);

  const scored = points.filter((p) => p.composite != null);
  const current = scored.length ? (scored[scored.length - 1].composite as number) : null;
  const delta = historyDelta(points);

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
          <p className="text-body-sm text-text-muted">{isTeam ? "Your team" : "You"} · trailing 30-day score</p>
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
                  <TrendChart points={points} />
                </div>
                <VolumeChart points={points} />
                <p className="text-caption text-text-subtle">
                  Daily score (trailing 30-day window) · bars show activity logged per day.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default PersistenceIndexReport;
