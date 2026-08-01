/**
 * LeadSourceFlow — the hero "Signature View" of the Lead Source Performance
 * report. Two horizontal bands connected by curved ribbons: the top band is each
 * source's share of leads created, the bottom band its share of won revenue. The
 * two bands sort INDEPENDENTLY (top by leads desc, bottom by revenue desc); the
 * crossings are the entire point (high-volume sources are usually not high-revenue
 * sources). Do not align the bands. See the spec (§2, §6, §9).
 *
 * Pure + presentational: it receives aggregated data and does only percentages +
 * geometry. Color arrives on the data (the page owns the source→color map). The
 * highlight (`activeSourceId`) is a controlled prop, never local state, so the
 * chart / table / scatter on the report stay in sync.
 *
 * Chrome hexes from the spec are mapped to theme tokens (the app themes light +
 * dark): axis/legend text → --color-text-subtle, legend hover → text-default.
 * Hardcodes (listed): segment %-label white (#fff, sits on colored fills) and the
 * grouped-tail gray #4A4D68 (the component synthesizes the grouped row).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type LeadSourceFlowDatum = {
  sourceId: string; // stable key, never the display label (allows the grouped "other_sources")
  label: string;
  color: string; // resolved token value, supplied by the page
  leads: number; // integer count of leads created in the window
  wonRevenue: number; // integer minor units (cents)
};

export type LeadSourceFlowProps = {
  data: LeadSourceFlowDatum[];
  activeSourceId?: string | null;
  onHoverSource?: (sourceId: string | null) => void;
  onSelectSource?: (sourceId: string) => void;
  isLoading?: boolean;
  className?: string;
  /** Layout override; defaults to "auto" (ribbon, or the compact fallback below 520px). */
  layout?: "auto" | "ribbon" | "compact";
};

// ── Geometry, in viewBox units (§6.1) ──
const W = 1000;
const H = 230;
const BAR_H = 32;
const TOP_Y = 26;
const BOT_Y = 172;
const MID = (TOP_Y + BAR_H + BOT_Y) / 2; // 115
const LABEL_MIN_W = 52;
const NARROW_PX = 520;
const GROUP_THRESHOLD = 0.02;
const GROUPED_ID = "other_sources";
const GROUPED_COLOR = "#4A4D68"; // hardcode: grouped-tail gray (component-synthesized row)
const MONO = "'JetBrains Mono', ui-monospace, monospace";

type Pos = { tx: number; tw: number; bx: number; bw: number };

/** Round each share, then absorb the remainder into the largest segment so the
 *  band reads exactly 100 (§6.6, §10). Returns integer percentages in input order. */
export function roundedShares(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return values.map(() => 0);
  const rounded = values.map((v) => Math.round((v / total) * 100));
  const remainder = 100 - rounded.reduce((a, b) => a + b, 0);
  if (remainder !== 0 && rounded.length > 0) {
    let maxI = 0;
    for (let i = 1; i < values.length; i++) if (values[i]! > values[maxI]!) maxI = i;
    rounded[maxI]! += remainder;
  }
  return rounded;
}

/** Group rows under 2% of BOTH bands into one "Other sources" row, but only past
 *  the long-tail threshold (>9 rows). Totals are computed first so shares still sum
 *  to 100 (§8 "Long tail"). Never drops a row. */
export function groupLongTail(data: LeadSourceFlowDatum[]): {
  rows: LeadSourceFlowDatum[];
  groupedMembers: string[];
} {
  if (data.length <= 9) return { rows: data, groupedMembers: [] };
  const totalLeads = data.reduce((a, r) => a + r.leads, 0);
  const totalRev = data.reduce((a, r) => a + r.wonRevenue, 0);
  const small = data.filter(
    (r) =>
      (totalLeads === 0 || r.leads / totalLeads < GROUP_THRESHOLD) &&
      (totalRev === 0 || r.wonRevenue / totalRev < GROUP_THRESHOLD),
  );
  if (small.length < 2) return { rows: data, groupedMembers: [] };
  const big = data.filter((r) => !small.includes(r));
  const grouped: LeadSourceFlowDatum = {
    sourceId: GROUPED_ID,
    label: "Other sources",
    color: GROUPED_COLOR,
    leads: small.reduce((a, r) => a + r.leads, 0),
    wonRevenue: small.reduce((a, r) => a + r.wonRevenue, 0),
  };
  return { rows: [...big, grouped], groupedMembers: small.map((r) => r.label) };
}

const bySortKey =
  (key: "leads" | "wonRevenue") => (a: LeadSourceFlowDatum, b: LeadSourceFlowDatum) =>
    b[key] - a[key] || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);

/** Independent-sort band layout (§6.2). Top band sorts by leads desc, bottom by
 *  won revenue desc, ties by sourceId asc; positions keyed by sourceId. Both the
 *  band rect and the ribbon end read from the same `tw`/`bw`, so ribbon end widths
 *  equal segment widths by construction. Pure, so the geometry is unit-testable. */
export function computeFlowLayout(rows: LeadSourceFlowDatum[]): {
  pos: Map<string, Pos>;
  totalLeads: number;
  totalRevenue: number;
} {
  const totalLeads = rows.reduce((a, r) => a + r.leads, 0);
  const totalRevenue = rows.reduce((a, r) => a + r.wonRevenue, 0);
  const byLeads = [...rows].sort(bySortKey("leads"));
  const byRev = [...rows].sort(bySortKey("wonRevenue"));
  const pos = new Map<string, Pos>();
  let x = 0;
  for (const r of byLeads) {
    const w = totalLeads > 0 ? (r.leads / totalLeads) * W : 0;
    pos.set(r.sourceId, { tx: x, tw: w, bx: 0, bw: 0 });
    x += w;
  }
  x = 0;
  for (const r of byRev) {
    const w = totalRevenue > 0 ? (r.wonRevenue / totalRevenue) * W : 0;
    const p = pos.get(r.sourceId)!;
    p.bx = x;
    p.bw = w;
    x += w;
  }
  return { pos, totalLeads, totalRevenue };
}

/** Ribbon cubic-bezier path (§6.4/§9), verbatim geometry. Ends at bw===0 taper
 *  to a point cleanly. */
export function ribbonPath(p: Pos): string {
  return (
    `M${p.tx},${TOP_Y + BAR_H}` +
    ` L${p.tx + p.tw},${TOP_Y + BAR_H}` +
    ` C${p.tx + p.tw},${MID} ${p.bx + p.bw},${MID} ${p.bx + p.bw},${BOT_Y}` +
    ` L${p.bx},${BOT_Y}` +
    ` C${p.bx},${MID} ${p.tx},${MID} ${p.tx},${TOP_Y + BAR_H} Z`
  );
}

export function LeadSourceFlow({
  data,
  activeSourceId = null,
  onHoverSource,
  onSelectSource,
  isLoading = false,
  className,
  layout = "auto",
}: LeadSourceFlowProps) {
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

  const { rows, groupedMembers } = React.useMemo(() => groupLongTail(data), [data]);
  const totalLeads = rows.reduce((a, r) => a + r.leads, 0);
  const totalRevenue = rows.reduce((a, r) => a + r.wonRevenue, 0);

  // Delegated handlers on the container (§7.2): enter via bubbling pointerover,
  // clear only when the pointer leaves the whole container (avoids ribbon↔band flicker).
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
      <div className={cn("w-full", className)} aria-busy="true" aria-label="Loading lead source flow">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden>
          <rect x="0" y={TOP_Y} width={W} height={BAR_H} rx="3" className="fill-surface-sunken" />
          <rect x="0" y={BOT_Y} width={W} height={BAR_H} rx="3" className="fill-surface-sunken" />
        </svg>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="h-3.5 w-24 animate-pulse rounded-radius-sm bg-surface-sunken" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0 || (totalLeads === 0 && totalRevenue === 0)) {
    return (
      <div className={cn("w-full", className)}>
        <div className="flex h-[132px] items-center justify-center rounded-radius-md border border-dashed border-border-subtle text-body-sm text-text-muted">
          No lead source data in this window yet.
        </div>
      </div>
    );
  }

  // Independent sorts — the source of the crossings (§6.2).
  const { pos } = computeFlowLayout(rows);
  const byLeads = [...rows].sort(bySortKey("leads"));
  const byRev = [...rows].sort(bySortKey("wonRevenue"));

  const leadShares = roundedShares(rows.map((r) => r.leads));
  const revShares = roundedShares(rows.map((r) => r.wonRevenue));
  const leadPct = new Map(rows.map((r, i) => [r.sourceId, leadShares[i]!]));
  const revPct = new Map(rows.map((r, i) => [r.sourceId, revShares[i]!]));

  const revenueNotEarned = totalLeads > 0 && totalRevenue === 0;
  const topSource = byLeads[0];
  const revSource = byRev.find((r) => r.wonRevenue > 0) ?? byRev[0];
  const ariaLabel = revenueNotEarned
    ? `Share of leads created by source. Largest lead source: ${topSource?.label ?? "none"}. No won revenue yet.`
    : `Share of leads compared with share of won revenue by source. Largest lead source: ${topSource?.label ?? "none"}. Largest revenue source: ${revSource?.label ?? "none"}.`;

  const dimFor = (sourceId: string) => activeSourceId != null && activeSourceId !== sourceId;

  return (
    <div
      ref={containerRef}
      className={cn("w-full", className)}
      onPointerOver={handleOver}
      onPointerLeave={handleLeave}
      onClick={handleClick}
    >
      {narrow ? (
        <CompactFallback rows={rows} leadPct={leadPct} revPct={revPct} activeSourceId={activeSourceId} />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
          <text x="0" y="14" aria-hidden style={AXIS_STYLE}>
            Share of leads created
          </text>
          {!revenueNotEarned && (
            <text x="0" y={BOT_Y + BAR_H + 18} aria-hidden style={AXIS_STYLE}>
              Share of won revenue
            </text>
          )}

          {/* Ribbons first (beneath the bands) — skipped when nothing has closed won. */}
          {!revenueNotEarned &&
            rows.map((r) => {
              const p = pos.get(r.sourceId)!;
              const on = activeSourceId === r.sourceId;
              return (
                <path
                  key={`rib-${r.sourceId}`}
                  className="lsf-anim cursor-pointer"
                  data-lsf-id={r.sourceId}
                  aria-hidden
                  d={ribbonPath(p)}
                  fill={r.color}
                  fillOpacity={on ? 0.55 : dimFor(r.sourceId) ? 0.16 : 0.3}
                />
              );
            })}

          {/* Band segments, then labels. */}
          {rows.map((r) => {
            const p = pos.get(r.sourceId)!;
            const dim = dimFor(r.sourceId);
            return (
              <React.Fragment key={`band-${r.sourceId}`}>
                <rect
                  className="lsf-anim cursor-pointer"
                  data-lsf-id={r.sourceId}
                  aria-hidden
                  x={p.tx}
                  y={TOP_Y}
                  width={Math.max(0, p.tw - 1)}
                  height={BAR_H}
                  rx="3"
                  fill={r.color}
                  style={{ opacity: dim ? 0.16 : 1 }}
                />
                {!revenueNotEarned && (
                  <rect
                    className="lsf-anim cursor-pointer"
                    data-lsf-id={r.sourceId}
                    aria-hidden
                    x={p.bx}
                    y={BOT_Y}
                    width={Math.max(0, p.bw - 1)}
                    height={BAR_H}
                    rx="3"
                    fill={r.color}
                    style={{ opacity: dim ? 0.16 : 1 }}
                  />
                )}
              </React.Fragment>
            );
          })}
          {rows.map((r) => {
            const p = pos.get(r.sourceId)!;
            return (
              <React.Fragment key={`lbl-${r.sourceId}`}>
                {p.tw > LABEL_MIN_W && (
                  <text x={p.tx + 7} y={TOP_Y + 20} aria-hidden style={SEG_STYLE}>
                    {leadPct.get(r.sourceId)}%
                  </text>
                )}
                {!revenueNotEarned && p.bw > LABEL_MIN_W && (
                  <text x={p.bx + 7} y={BOT_Y + 20} aria-hidden style={SEG_STYLE}>
                    {revPct.get(r.sourceId)}%
                  </text>
                )}
              </React.Fragment>
            );
          })}
        </svg>
      )}

      {revenueNotEarned && (
        <p className="mt-2 text-caption text-text-muted">
          Revenue share appears once deals close.
        </p>
      )}

      {/* Accessible table — the a11y path and the cleanest thing to test against (§11). */}
      <table className="sr-only">
        <caption>Lead source flow: leads and won revenue by source.</caption>
        <thead>
          <tr>
            <th>Source</th>
            <th>Leads</th>
            <th>Lead share</th>
            <th>Won revenue</th>
            <th>Revenue share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sourceId}>
              <td>{r.label}</td>
              <td>{r.leads}</td>
              <td>{leadPct.get(r.sourceId)}%</td>
              <td>{r.wonRevenue}</td>
              <td>{revPct.get(r.sourceId)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Legend — one real button per source, in incoming data order (§6.8). */}
      <ul className="mt-3 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
        {rows.map((r) => (
          <li key={r.sourceId}>
            <button
              type="button"
              data-lsf-id={r.sourceId}
              title={r.sourceId === GROUPED_ID ? groupedMembers.join(", ") : undefined}
              onFocus={() => onHoverSource?.(r.sourceId)}
              onBlur={() => onHoverSource?.(null)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-radius-sm bg-transparent text-caption",
                activeSourceId === r.sourceId ? "text-text-default" : "text-text-subtle hover:text-text-default",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2",
              )}
            >
              <span
                aria-hidden
                className="inline-block h-[9px] w-[9px] rounded-[2.5px]"
                style={{ background: r.color, opacity: dimFor(r.sourceId) ? 0.4 : 1 }}
              />
              {r.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const AXIS_STYLE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  fill: "var(--color-text-subtle)",
};
const SEG_STYLE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 500,
  fill: "#fff",
  pointerEvents: "none",
};

/** Narrow (<520px) fallback: a ranked list, each row showing the label and two
 *  paired inline bars (lead share above, revenue share below) in the source color.
 *  Same data, same active-source behavior, different geometry (§8 "Narrow"). */
function CompactFallback({
  rows,
  leadPct,
  revPct,
  activeSourceId,
}: {
  rows: LeadSourceFlowDatum[];
  leadPct: Map<string, number>;
  revPct: Map<string, number>;
  activeSourceId?: string | null;
}) {
  const ranked = [...rows].sort(bySortKey("leads"));
  return (
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
              <span>{r.label}</span>
              <span className="tabular-nums text-text-subtle">
                {leadPct.get(r.sourceId)}% / {revPct.get(r.sourceId)}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken">
              <span className="block h-full" style={{ width: `${leadPct.get(r.sourceId)}%`, background: r.color }} />
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken">
              <span
                className="block h-full"
                style={{ width: `${revPct.get(r.sourceId)}%`, background: r.color, opacity: 0.7 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default LeadSourceFlow;
