/**
 * LeadSourceEfficiency — the second analytical panel of the Lead Source
 * Performance report, beside the Signature View ribbon (LeadSourceFlow). A bubble
 * scatter: x = median activity touches a won deal needed, y = win rate, bubble
 * area = lead volume. The reading is diagonal — up-and-left wins more with fewer
 * touches; a big bubble down-and-right is the most expensive thing on the report.
 * See the spec (§2, §6, §8, §9).
 *
 * Pure + presentational: aggregated data in, scale mapping + geometry only. Color
 * arrives on the data. `activeSourceId` is a controlled prop (never local state),
 * shared with LeadSourceFlow so hover stays in sync across the report.
 *
 * Two intentional deviations from the reference (spec §7): Y ticks use a nice-step
 * ladder (§6.3), and the reference line is the won-deal-weighted median (§6.5),
 * not the reference's unweighted mean.
 *
 * Chrome hexes mapped to theme tokens (app themes light + dark): axis/caption text
 * → --color-text-subtle, active caption → text-default. Hardcode (listed): the
 * gridline/bubble-caption slate #9FAEE8 has no exact token, driven at the spec's
 * alphas; below-floor dagger + footnote copy are literals.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type LeadSourceEfficiencyDatum = {
  sourceId: string; // stable key, never the display label
  label: string;
  shortLabel: string; // bubble caption
  color: string; // resolved token value, supplied by the page
  leads: number; // integer, drives bubble area
  wonDeals: number; // integer, deals from those leads now in Won
  winRate: number; // percent 0..100, one decimal (precomputed; do not derive)
  touchesToWin: number; // median activities before win (precomputed)
  belowFloor: boolean; // wonDeals < 5 → render dimmed + dagger, exclude from reference line
};

export type LeadSourceEfficiencyProps = {
  data: LeadSourceEfficiencyDatum[];
  activeSourceId?: string | null;
  onHoverSource?: (sourceId: string | null) => void;
  onSelectSource?: (sourceId: string) => void;
  isLoading?: boolean;
  className?: string;
  /** Layout override; defaults to "auto" (scatter, or the ranked-list fallback below 520px). */
  layout?: "auto" | "scatter" | "compact";
};

// ── Geometry, in viewBox units (§6.1) ──
const W = 560;
const H = 340;
const L = 52;
const R = 18;
const T = 20;
const B = 44;
const PLOT_W = W - L - R; // 490
const PLOT_H = H - T - B; // 276
const NARROW_PX = 520;
const CAP_CHAR_W = 6.6; // mono 9.5px + .13em letter-spacing, approx per-char width for overlap tests
const CAP_H = 9.5;
const SLATE = "#9FAEE8"; // hardcode: gridline / caption slate (no exact theme token)
const MONO = "'JetBrains Mono', ui-monospace, monospace";

/** "Nice" axis step for a target raw magnitude (§6.3). Guards non-positive input. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return s * mag;
}

/** Y axis via the nice-step ladder (deviation §6.3/§7). axisTop guarded to ≥ step. */
export function computeYAxis(winRates: number[]): { step: number; axisTop: number; ticks: number[] } {
  const maxWin = winRates.length ? Math.max(...winRates) : 0;
  const step = niceStep(maxWin / 4);
  const axisTop = Math.max(step, Math.ceil(maxWin / step) * step || step);
  const ticks: number[] = [];
  for (let t = 0; t <= axisTop + 1e-9; t += step) ticks.push(Math.round(t));
  return { step, axisTop, ticks };
}

/** X window around the observed touch range (§6.2), with the degenerate-collapse guard. */
export function computeXScale(touches: number[]): { xMin: number; xMax: number } {
  if (touches.length === 0) return { xMin: 0, xMax: 1 };
  const min = Math.min(...touches);
  const max = Math.max(...touches);
  // Every source identical → the padded window still would not collapse, but the
  // reading is meaningless; center the single column on a ±1 window (§6.2).
  if (max - min < 1e-9) return { xMin: min - 1, xMax: min + 1 };
  return { xMin: Math.max(0, min - 1), xMax: max * 1.15 };
}

/** Square-root radius so bubble AREA tracks lead volume; +6 floor for a hittable
 *  minimum (§6.6). Area is therefore only asymptotically proportional (intended). */
export function bubbleRadius(leads: number, maxLeads: number): number {
  return 6 + Math.sqrt(maxLeads > 0 ? leads / maxLeads : 0) * 24;
}

/** Won-deal-weighted median of touchesToWin (deviation §6.5/§7). Sort ascending by
 *  touches, accumulate wonDeals, return the touches of the source where the running
 *  total first reaches half the won deals. Caller passes eligible (non-below-floor)
 *  rows only. Returns null when there is nothing to weight. */
export function weightedMedianTouches(rows: LeadSourceEfficiencyDatum[]): number | null {
  const eligible = rows.filter((r) => r.wonDeals > 0);
  const totalWon = eligible.reduce((a, r) => a + r.wonDeals, 0);
  if (totalWon === 0) return null;
  const sorted = [...eligible].sort(
    (a, b) => a.touchesToWin - b.touchesToWin || (a.sourceId < b.sourceId ? -1 : 1),
  );
  let acc = 0;
  for (const r of sorted) {
    acc += r.wonDeals;
    if (acc >= totalWon / 2) return r.touchesToWin;
  }
  return sorted[sorted.length - 1]!.touchesToWin;
}

const AXIS_STYLE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  fill: "var(--color-text-subtle)",
};
const QUAD_STYLE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  fill: "var(--color-text-subtle)",
};

export function LeadSourceEfficiency({
  data,
  activeSourceId = null,
  onHoverSource,
  onSelectSource,
  isLoading = false,
  className,
  layout = "auto",
}: LeadSourceEfficiencyProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [autoNarrow, setAutoNarrow] = React.useState(false);

  React.useEffect(() => {
    if (layout !== "auto") return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.offsetWidth;
      if (w > 0) setAutoNarrow(w < NARROW_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);

  const narrow = layout === "compact" || (layout === "auto" && autoNarrow);

  // Delegated handlers on the container (§8.2): enter via bubbling pointerover,
  // clear only when the pointer leaves the whole container (no cross-bubble flicker).
  const idFromEvent = (e: React.SyntheticEvent): string | null =>
    (e.target as Element).closest<HTMLElement>("[data-lsf-id]")?.dataset.lsfId ?? null;
  const handleOver = (e: React.PointerEvent) => {
    const id = idFromEvent(e);
    if (id) onHoverSource?.(id);
  };
  const handleLeave = () => onHoverSource?.(null);
  const handleClick = (e: React.MouseEvent) => {
    const id = idFromEvent(e);
    if (id) onSelectSource?.(id);
  };

  if (isLoading) {
    return (
      <div className={cn("w-full", className)} aria-busy="true" aria-label="Loading lead source efficiency">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden>
          {[
            [420, 250, 28],
            [180, 120, 14],
            [300, 200, 12],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} className="animate-pulse fill-surface-sunken" />
          ))}
        </svg>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn("w-full", className)}>
        <div className="flex h-[200px] items-center justify-center rounded-radius-md border border-dashed border-border-subtle text-body-sm text-text-muted">
          No lead source data in this window yet.
        </div>
      </div>
    );
  }

  const noClosedWon = data.every((r) => r.wonDeals === 0);
  const plotRows = data.filter((r) => r.wonDeals > 0 && Number.isFinite(r.touchesToWin));
  const noWinLabels = data.filter((r) => r.wonDeals === 0).map((r) => r.label);

  // Shared accessible + keyboard scaffolding (renders in every non-empty state).
  const mostEfficient = [...plotRows].sort(
    (a, b) => b.winRate - a.winRate || a.touchesToWin - b.touchesToWin,
  )[0];
  const leastEfficient = [...plotRows].sort(
    (a, b) => a.winRate - b.winRate || b.touchesToWin - a.touchesToWin,
  )[0];
  const ariaLabel = noClosedWon
    ? "Win rate against touches to win by source. No closed won yet."
    : `Win rate against touches to win by source. Most efficient: ${mostEfficient?.label ?? "none"}. Least efficient: ${leastEfficient?.label ?? "none"}.`;

  const keyboardList = (
    <ul className="sr-only" aria-label="Lead sources, keyboard-navigable">
      {data.map((r) => (
        <li key={r.sourceId}>
          <button
            type="button"
            data-lsf-id={r.sourceId}
            onFocus={() => onHoverSource?.(r.sourceId)}
            onBlur={() => onHoverSource?.(null)}
          >
            {r.label}: win rate {r.winRate}%,{" "}
            {r.wonDeals > 0 && Number.isFinite(r.touchesToWin) ? `${r.touchesToWin} median touches to win` : "no closed won"}
            , {r.leads} leads{r.belowFloor ? ", below the 5-deal floor" : ""}.
          </button>
        </li>
      ))}
    </ul>
  );

  const hiddenTable = (
    <table className="sr-only">
      <caption>Lead source efficiency: win rate and median touches to win by source.</caption>
      <thead>
        <tr>
          <th>Source</th>
          <th>Leads</th>
          <th>Won deals</th>
          <th>Win rate</th>
          <th>Median touches to win</th>
          <th>Below floor</th>
        </tr>
      </thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.sourceId}>
            <td>{r.label}</td>
            <td>{r.leads}</td>
            <td>{r.wonDeals}</td>
            <td>{r.winRate}%</td>
            <td>{r.wonDeals > 0 && Number.isFinite(r.touchesToWin) ? r.touchesToWin : "n/a"}</td>
            <td>{r.belowFloor ? "yes" : "no"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  // ── Narrow fallback: ranked list by win rate desc (§9 item 7) ──
  if (narrow) {
    const ranked = [...data].sort((a, b) => b.winRate - a.winRate);
    const maxWin = Math.max(...data.map((r) => r.winRate), 1);
    return (
      <div
        ref={containerRef}
        className={cn("w-full", className)}
        onPointerOver={handleOver}
        onPointerLeave={handleLeave}
        onClick={handleClick}
      >
        {keyboardList}
        <div className="flex flex-col gap-2.5">
          {ranked.map((r) => {
            const dim = activeSourceId != null && activeSourceId !== r.sourceId;
            return (
              <div
                key={r.sourceId}
                data-lsf-id={r.sourceId}
                className="lsf-anim cursor-pointer"
                style={{ opacity: dim ? 0.4 : 1 }}
              >
                <div className="flex items-baseline justify-between text-caption text-text-default">
                  <span>
                    {r.label}
                    {r.belowFloor ? " †" : ""}
                  </span>
                  <span className="tabular-nums text-text-subtle">
                    {r.winRate}% ·{" "}
                    {r.wonDeals > 0 && Number.isFinite(r.touchesToWin) ? `${r.touchesToWin} touches` : "no win"}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken">
                  <span
                    className="block h-full"
                    style={{ width: `${(r.winRate / maxWin) * 100}%`, background: r.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {data.some((r) => r.belowFloor) && (
          <p className="mt-2 text-caption text-text-muted">
            &#8224; Fewer than 5 closed won; the touch median moves on one deal.
          </p>
        )}
        {hiddenTable}
      </div>
    );
  }

  // ── No closed won anywhere (§9 item 3): axes + message, no bubbles ──
  if (noClosedWon || plotRows.length === 0) {
    const { ticks, axisTop } = computeYAxis(data.map((r) => r.winRate));
    const Y = (v: number) => H - B - (v / axisTop) * PLOT_H;
    return (
      <div ref={containerRef} className={cn("w-full", className)}>
        {keyboardList}
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} y1={Y(t)} x2={W - R} y2={Y(t)} stroke={SLATE} strokeOpacity={0.14} strokeWidth={1} />
              <text x={L - 9} y={Y(t) + 3} textAnchor="end" style={AXIS_STYLE}>
                {t}%
              </text>
            </g>
          ))}
          <text x={(W + L) / 2} y={H - 8} textAnchor="middle" style={AXIS_STYLE}>
            Median touches before close won
          </text>
          <text x={4} y={T - 6} style={AXIS_STYLE}>
            Win rate
          </text>
        </svg>
        <p className="mt-2 text-caption text-text-muted">Efficiency appears once deals close.</p>
        {hiddenTable}
      </div>
    );
  }

  // ── Scatter (has at least one closed-won source) ──
  const { ticks, axisTop } = computeYAxis(plotRows.map((r) => r.winRate));
  const { xMin, xMax } = computeXScale(plotRows.map((r) => r.touchesToWin));
  const maxLeads = Math.max(...plotRows.map((r) => r.leads), 1);
  const X = (v: number) => L + ((v - xMin) / (xMax - xMin)) * PLOT_W;
  const Y = (v: number) => H - B - (v / axisTop) * PLOT_H;

  // Weighted-median reference line, excluding below-floor sources; suppressed for a
  // single source or when nothing is eligible (§6.5, §9 items 5 & 6).
  const eligible = plotRows.filter((r) => !r.belowFloor);
  const refValue = plotRows.length > 1 && eligible.length > 0 ? weightedMedianTouches(eligible) : null;
  const refX = refValue != null ? X(refValue) : null;
  const showLeftCap = refX != null && refX - L > 60;
  const showRightCap = refX != null && W - R - refX > 60;

  // Draw order: largest radius first so the smallest bubble paints last (on top) (§6.6).
  const drawn = [...plotRows]
    .map((r) => {
      const rad = bubbleRadius(r.leads, maxLeads);
      const cx = X(r.touchesToWin);
      const cy = Y(r.winRate);
      return { r, rad, cx, cy, baseline: cy - rad - 6, capW: (r.shortLabel.length + (r.belowFloor ? 1 : 0)) * CAP_CHAR_W };
    })
    .sort((a, b) => b.rad - a.rad);

  // Caption suppression on bounding-box overlap in draw order, keeping the earlier
  // (larger) one (§6.6). A suppressed caption still shows when its source is active.
  const suppressed = new Set<string>();
  const drawnBoxes: { x1: number; x2: number; y1: number; y2: number }[] = [];
  for (const b of drawn) {
    const box = { x1: b.cx - b.capW / 2, x2: b.cx + b.capW / 2, y1: b.baseline - CAP_H, y2: b.baseline };
    const overlaps = drawnBoxes.some(
      (d) => !(box.x2 < d.x1 || box.x1 > d.x2 || box.y2 < d.y1 || box.y1 > d.y2),
    );
    if (overlaps) suppressed.add(b.r.sourceId);
    else drawnBoxes.push(box);
  }

  return (
    <div
      ref={containerRef}
      className={cn("w-full", className)}
      onPointerOver={handleOver}
      onPointerLeave={handleLeave}
      onClick={handleClick}
    >
      {keyboardList}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        {/* Gridlines + y tick labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} y1={Y(t)} x2={W - R} y2={Y(t)} stroke={SLATE} strokeOpacity={0.14} strokeWidth={1} />
            <text x={L - 9} y={Y(t) + 3} textAnchor="end" style={AXIS_STYLE}>
              {t}%
            </text>
          </g>
        ))}

        {/* Reference line + quadrant captions */}
        {refX != null && (
          <>
            <line
              x1={refX}
              y1={T}
              x2={refX}
              y2={H - B}
              stroke={SLATE}
              strokeOpacity={0.28}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            {showLeftCap && (
              <text x={refX - 8} y={T + 11} textAnchor="end" style={QUAD_STYLE}>
                fewer touches
              </text>
            )}
            {showRightCap && (
              <text x={refX + 8} y={T + 11} style={QUAD_STYLE}>
                more touches
              </text>
            )}
          </>
        )}

        {/* Bubbles (largest first). Visible circle is inert; the larger transparent
            hit circle carries pointer events so tiny bubbles stay reachable (§8.1). */}
        {drawn.map((b) => {
          const on = activeSourceId === b.r.sourceId;
          const capShown = on || !suppressed.has(b.r.sourceId);
          return (
            <g key={b.r.sourceId} data-lsf-id={b.r.sourceId} className="cursor-pointer">
              <circle
                className="lsf-anim"
                cx={b.cx}
                cy={b.cy}
                r={b.rad}
                fill={b.r.color}
                fillOpacity={b.r.belowFloor ? 0.18 : on ? 0.75 : 0.42}
                stroke={on ? "#fff" : b.r.color}
                strokeWidth={on ? 2 : 1.2}
                strokeDasharray={b.r.belowFloor ? "2 3" : undefined}
                style={{ pointerEvents: "none" }}
              />
              <circle cx={b.cx} cy={b.cy} r={Math.max(b.rad, 14)} fill="transparent" />
              {capShown && (
                <text
                  x={b.cx}
                  y={b.baseline}
                  textAnchor="middle"
                  aria-hidden
                  style={{
                    fontFamily: MONO,
                    fontSize: 9.5,
                    letterSpacing: ".13em",
                    textTransform: "uppercase",
                    fill: on ? "var(--color-text-default)" : SLATE,
                    pointerEvents: "none",
                  }}
                >
                  {b.r.shortLabel}
                  {b.r.belowFloor ? "†" : ""}
                </text>
              )}
            </g>
          );
        })}

        {/* Axis titles */}
        <text x={(W + L) / 2} y={H - 8} textAnchor="middle" aria-hidden style={AXIS_STYLE}>
          Median touches before close won
        </text>
        <text x={4} y={T - 6} aria-hidden style={AXIS_STYLE}>
          Win rate
        </text>
      </svg>

      {noWinLabels.length > 0 && (
        <p className="mt-2 text-caption text-text-muted">No closed won yet: {noWinLabels.join(", ")}.</p>
      )}
      {data.some((r) => r.belowFloor) && (
        <p className="mt-2 text-caption text-text-muted">
          &#8224; Marks a source with fewer than 5 closed won. Its touch median moves on one deal.
        </p>
      )}
      {hiddenTable}
    </div>
  );
}

export default LeadSourceEfficiency;
