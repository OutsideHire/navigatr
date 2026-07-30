/**
 * Lead Source Performance report (LS-2b). Which origination channels produce
 * closed-won business, at what touch cost, at what yield per lead. Restyled from
 * the prototype (artifact 97e7756a): controls (window / attribution basis /
 * scope), banners, KPI cards, the "share of leads vs share of revenue" ribbon,
 * the sortable source table, and the win-rate-vs-touches scatter. Route:
 * /dashboard/lead-source.
 *
 * Role scoping is automatic: useDeals is RLS-scoped, so a rep sees their own
 * book (rep-scoped report) and a manager sees the team (per Robert). MRR = deal
 * value / 12. The per-source drill-down drawer is LS-2c.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/navigatr";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { leadSourceSetBy } from "@/features/pipeline/lib/leadSources";
import { formatBandUsd } from "../lib/activityToWin";
import {
  computeLeadSourcePerformance,
  type AttributionBasis,
  type SourceScope,
  type LeadSourceRow,
} from "../lib/leadSourcePerformance";

const WINDOWS = [30, 90, 180] as const;
const SOURCE_COLOR: Record<string, string> = {
  path: "#8A72F2",
  self_sourced_canvass: "#B48CF5",
  partner_referral: "#2E5FE2",
  customer_referral: "#5B8CF5",
  event_association: "#D9A5F0",
  inbound: "#86AEF8",
  assigned: "#6B6E8F",
  import: "#4A4D68",
  other: "#8E90A8",
  unknown: "#6E7191",
};
const colorOf = (s: string) => SOURCE_COLOR[s] ?? "#6E7191";

function Seg<T extends string | number>({
  value, options, onChange, ariaLabel,
}: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-radius-md border border-border-subtle bg-surface-sunken p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "rounded-radius-sm px-3 py-1.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
            value === o.v ? "bg-brand-primary text-brand-primary-foreground" : "text-text-muted hover:text-text-default",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One row per bucket: label, value, sub. */
function Kpi({ label, value, sub, flag }: { label: string; value: string; sub: string; flag?: boolean }) {
  return (
    <Card padding="md" shadow="sm" className={cn(flag && "border-status-warning/40 bg-status-warning-bg")}>
      <div className="flex flex-col gap-1">
        <span className="text-eyebrow uppercase tracking-wide text-text-subtle">{label}</span>
        <span className={cn("text-heading-sm tabular-nums text-text-default", flag && "text-status-warning")}>{value}</span>
        <span className="text-caption text-text-subtle">{sub}</span>
      </div>
    </Card>
  );
}

/** Signature ribbon: top band = share of leads, bottom = share of won revenue,
 *  crossing ribbons connect each source's two segments. */
function Ribbon({ rows, totalLeads, totalMrr }: { rows: LeadSourceRow[]; totalLeads: number; totalMrr: number }) {
  const W = 1000, barH = 30, topY = 26, botY = 168, mid = (topY + barH + botY) / 2, H = 214;
  if (!totalLeads || !totalMrr) {
    return <p className="text-body-sm text-text-muted">Not enough won revenue in this window to chart the split.</p>;
  }
  const byLeads = [...rows].sort((a, b) => b.leads - a.leads);
  const byMrr = [...rows].sort((a, b) => b.mrrWonCents - a.mrrWonCents);
  const pos = new Map<string, { tx: number; tw: number; bx: number; bw: number }>();
  let x = 0;
  for (const r of byLeads) { const w = (r.leads / totalLeads) * W; pos.set(r.source, { tx: x, tw: w, bx: 0, bw: 0 }); x += w; }
  x = 0;
  for (const r of byMrr) { const p = pos.get(r.source)!; const w = (r.mrrWonCents / totalMrr) * W; p.bx = x; p.bw = w; x += w; }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label="Share of leads compared with share of won revenue by source">
        <text x={0} y={14} className="fill-text-subtle text-[11px] uppercase tracking-wide">Share of leads created</text>
        <text x={0} y={botY + barH + 16} className="fill-text-subtle text-[11px] uppercase tracking-wide">Share of won revenue</text>
        {rows.map((r) => {
          const p = pos.get(r.source)!;
          const c = colorOf(r.source);
          const d = `M${p.tx},${topY + barH} L${p.tx + p.tw},${topY + barH} C${p.tx + p.tw},${mid} ${p.bx + p.bw},${mid} ${p.bx + p.bw},${botY} L${p.bx},${botY} C${p.bx},${mid} ${p.tx},${mid} ${p.tx},${topY + barH} Z`;
          return <path key={`rib-${r.source}`} d={d} fill={c} fillOpacity={0.28} />;
        })}
        {rows.map((r) => {
          const p = pos.get(r.source)!;
          const c = colorOf(r.source);
          const leadPct = Math.round((r.leads / totalLeads) * 100);
          const mrrPct = Math.round((r.mrrWonCents / totalMrr) * 100);
          return (
            <g key={`bars-${r.source}`}>
              <rect x={p.tx} y={topY} width={Math.max(0, p.tw - 1)} height={barH} rx={3} fill={c} />
              <rect x={p.bx} y={botY} width={Math.max(0, p.bw - 1)} height={barH} rx={3} fill={c} />
              {p.tw > 52 && <text x={p.tx + 7} y={topY + 20} className="fill-white text-[11px] font-medium">{leadPct}%</text>}
              {p.bw > 52 && <text x={p.bx + 7} y={botY + 20} className="fill-white text-[11px] font-medium">{mrrPct}%</text>}
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <span key={`lg-${r.source}`} className="inline-flex items-center gap-1.5 text-caption text-text-muted">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: colorOf(r.source) }} aria-hidden />
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Win rate (y) against median touches to win (x); bubble area = lead volume. */
function Scatter({ rows }: { rows: LeadSourceRow[] }) {
  const plot = rows.filter((r) => r.won > 0 && r.touchesToWin != null);
  if (plot.length === 0) return <p className="text-body-sm text-text-muted">No wins in this window to plot.</p>;
  const W = 560, H = 320, L = 46, R = 18, T = 18, B = 40;
  const xs = plot.map((r) => r.touchesToWin as number);
  const ys = plot.map((r) => r.winRate);
  const xMax = Math.max(...xs) * 1.15 || 1, xMin = Math.max(0, Math.min(...xs) - 1);
  const yMax = Math.max(...ys) * 1.2 || 1;
  const maxLeads = Math.max(...plot.map((r) => r.leads), 1);
  const X = (v: number) => L + ((v - xMin) / (xMax - xMin || 1)) * (W - L - R);
  const Y = (v: number) => H - B - (v / yMax) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4];
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[420px]" role="img" aria-label="Win rate against median touches to win by source">
        {ticks.map((k) => {
          const yv = (yMax / 4) * k; const y = Y(yv);
          return (
            <g key={k}>
              <line x1={L} y1={y} x2={W - R} y2={y} className="stroke-border-subtle" strokeWidth={1} />
              <text x={L - 8} y={y + 3} textAnchor="end" className="fill-text-subtle text-[10px]">{yv.toFixed(0)}%</text>
            </g>
          );
        })}
        {plot.map((r) => {
          const rad = 6 + Math.sqrt(r.leads / maxLeads) * 22;
          return (
            <g key={`bub-${r.source}`}>
              <circle cx={X(r.touchesToWin as number)} cy={Y(r.winRate)} r={rad} fill={colorOf(r.source)} fillOpacity={0.42} stroke={colorOf(r.source)} strokeWidth={1.2} />
              <text x={X(r.touchesToWin as number)} y={Y(r.winRate) - rad - 5} textAnchor="middle" className="fill-text-muted text-[10px] uppercase tracking-wide">
                {r.label.split(" ")[0]}
              </text>
            </g>
          );
        })}
        <text x={(W + L) / 2} y={H - 6} textAnchor="middle" className="fill-text-subtle text-[10px] uppercase tracking-wide">Median touches before close won</text>
      </svg>
    </div>
  );
}

const TABLE_COLS: { key: keyof LeadSourceRow | "setBy"; label: string; sortable: boolean }[] = [
  { key: "label", label: "Source", sortable: false },
  { key: "setBy", label: "Set by", sortable: false },
  { key: "leads", label: "Leads", sortable: true },
  { key: "won", label: "Won", sortable: true },
  { key: "winRate", label: "Win rate", sortable: true },
  { key: "touchesToWin", label: "Touches to win", sortable: true },
  { key: "daysToClose", label: "Days to close", sortable: true },
  { key: "mrrWonCents", label: "MRR won", sortable: true },
  { key: "yieldCents", label: "MRR per lead", sortable: true },
];

const RULES: { title: string; body: string }[] = [
  { title: "First touch, set once", body: "Source is written at lead creation and locked. Reps can only set it from Other or Unknown." },
  { title: "System set beats rep set", body: "Path, Partner Referral, Assigned, and Import are written by the platform. Reps never pick those four." },
  { title: "Import and Assigned sit outside rep sourced", body: "Neither one is prospecting. They pull the blend down, which is why rep sourced is the default scope." },
  { title: "Partner and Customer Referral stay separate", body: "Only Partner Referral carries partner attribution and status write-back to the portal." },
  { title: "Touches to win reads from activity", body: "Calls, drop-ins, and appointments logged against the deal before close won. MRR is deal value divided by 12." },
];

export function LeadSourceReport() {
  const navigate = useNavigate();
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();

  const [windowDays, setWindowDays] = React.useState<number>(180);
  const [basis, setBasis] = React.useState<AttributionBasis>("created");
  const [scope, setScope] = React.useState<SourceScope>("rep");
  const [sortKey, setSortKey] = React.useState<string>("yieldCents");
  const [sortDir, setSortDir] = React.useState<-1 | 1>(-1);

  const perf = React.useMemo(
    () => computeLeadSourcePerformance(deals, activities, { now: new Date(), windowDays, basis, scope }),
    [deals, activities, windowDays, basis, scope],
  );

  const sorted = React.useMemo(() => {
    const rows = [...perf.rows];
    rows.sort((a, b) => {
      if (sortKey === "label") return a.label.localeCompare(b.label) * -sortDir;
      const av = (a[sortKey as keyof LeadSourceRow] as number) ?? -1;
      const bv = (b[sortKey as keyof LeadSourceRow] as number) ?? -1;
      return (av - bv) * sortDir;
    });
    return rows;
  }, [perf.rows, sortKey, sortDir]);

  const t = perf.totals;
  const best = perf.rows.reduce<LeadSourceRow | null>((acc, r) => (acc == null || r.yieldCents > acc.yieldCents ? r : acc), null);
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir((d) => (d === -1 ? 1 : -1));
    else { setSortKey(k); setSortDir(-1); }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => navigate("/dashboard")} className="inline-flex w-fit items-center gap-1 text-caption text-text-muted hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
          </button>
          <h1 className="text-heading-lg text-text-default">Lead source performance</h1>
          <p className="max-w-2xl text-body-sm text-text-muted">
            Which origination channels produce closed-won business, at what touch cost, and at what yield per lead. Volume is context, not the answer.
          </p>
        </div>

        {/* Controls */}
        <Card padding="md" shadow="sm">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-eyebrow uppercase tracking-wide text-text-subtle">Window</span>
              <Seg ariaLabel="Reporting window" value={windowDays} onChange={setWindowDays} options={WINDOWS.map((w) => ({ v: w, label: `${w} days` }))} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-eyebrow uppercase tracking-wide text-text-subtle">Attribution basis</span>
              <Seg ariaLabel="Attribution basis" value={basis} onChange={setBasis} options={[{ v: "created" as const, label: "Cohort by created date" }, { v: "won" as const, label: "Won in period" }]} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-eyebrow uppercase tracking-wide text-text-subtle">Scope</span>
              <Seg ariaLabel="Scope" value={scope} onChange={setScope} options={[{ v: "rep" as const, label: "Rep sourced only" }, { v: "all" as const, label: "All sources" }]} />
            </label>
          </div>
        </Card>

        {/* Banners */}
        {(perf.flags.mixedBasis || perf.flags.worstImmature || perf.flags.hasInbound || perf.flags.allScope) && (
          <div className="flex flex-col gap-2">
            {perf.flags.worstImmature && (
              <Banner tone="warn">
                <b>Cohort not yet mature.</b> {perf.flags.immatureSources.length} of {perf.rows.length} sources have cohorts younger than their own median time to close, so win rate reads low ({perf.flags.worstImmature.label} is the most affected at ~{perf.flags.worstImmature.maturityPct}%). Compare sources inside this view, not against a longer window.
              </Banner>
            )}
            {perf.flags.mixedBasis && (
              <Banner tone="warn">
                <b>Mixed cohorts.</b> Wins in this window came from leads created before it, so win rate is not a valid ratio here. Use the created-date basis to compare sources.
              </Banner>
            )}
            {perf.flags.hasInbound && (
              <Banner tone="info">
                <b>Known blind spot.</b> Inbound is rep-captured only. Email is not yet captured and prospects call rep cell numbers directly, so inbound volume is a floor, not a count.
              </Banner>
            )}
            {perf.flags.allScope && (
              <Banner tone="info">
                <b>Assigned and Import included.</b> Neither is prospecting; they pull the blended win rate and yield down, which is why rep sourced is the default scope.
              </Banner>
            )}
          </div>
        )}

        {/* KPIs */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Leads created" value={t.leads.toLocaleString()} sub={`${scope === "rep" ? "Rep sourced" : "All sources"}, ${windowDays} day window`} />
          <Kpi label="Closed won" value={t.won.toLocaleString()} sub={`Blended win rate ${t.winRate.toFixed(1)}%`} />
          <Kpi label="MRR won per lead" value={formatBandUsd(t.yieldCents)} sub={`Blended across ${perf.rows.length} sources`} />
          <Kpi label="Highest yield source" value={best ? best.label : "n/a"} sub={best ? `${formatBandUsd(best.yieldCents)} per lead` : ""} flag />
        </div>

        {/* Signature ribbon */}
        <Card padding="lg" shadow="sm">
          <div className="mb-3">
            <h2 className="text-body-strong text-text-default">Share of leads, share of revenue</h2>
            <p className="text-caption text-text-muted">The top band is where lead volume comes from; the bottom band is where won revenue comes from. A crossing ribbon is a source over- or under-weighted relative to what it returns.</p>
          </div>
          <Ribbon rows={perf.rows} totalLeads={t.leads} totalMrr={t.mrrWonCents} />
        </Card>

        {/* Source table */}
        <Card padding="none" shadow="sm">
          <div className="px-4 pt-4">
            <h2 className="text-body-strong text-text-default">Source table</h2>
            <p className="text-caption text-text-muted">Sort any column.</p>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-caption">
              <thead>
                <tr className="border-b border-border-subtle text-right text-eyebrow uppercase tracking-wide text-text-subtle">
                  {TABLE_COLS.map((c, i) => (
                    <th key={c.key} className={cn("px-3 py-2 font-medium", i < 2 && "text-left")}>
                      {c.sortable ? (
                        <button type="button" onClick={() => onSort(c.key)} className="hover:text-text-default">
                          {c.label}{sortKey === c.key ? (sortDir === -1 ? " ↓" : " ↑") : ""}
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums text-text-default">
                {sorted.map((r) => (
                  <tr key={r.source} className={cn("border-b border-border-subtle", !r.repSourced && "text-text-muted")}>
                    <td className="px-3 py-2.5 text-left">
                      <span className="flex items-center gap-2">
                        <span className="h-3.5 w-2 rounded-[2px]" style={{ background: colorOf(r.source) }} aria-hidden />
                        <span className="text-body-sm font-medium text-text-default">{r.label}</span>
                        {r.source === "partner_referral" && <span className="rounded-radius-sm bg-status-warning-bg px-1.5 py-0.5 text-[9.5px] uppercase text-status-warning">bypasses ICP filter</span>}
                        {r.source === "inbound" && <span className="rounded-radius-sm bg-status-warning-bg px-1.5 py-0.5 text-[9.5px] uppercase text-status-warning">undercounted</span>}
                        {!r.repSourced && <span className="rounded-radius-sm bg-surface-sunken px-1.5 py-0.5 text-[9.5px] uppercase text-text-subtle">not rep sourced</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-left text-text-subtle">{leadSourceSetBy(r.source) === "system" ? "SYSTEM" : leadSourceSetBy(r.source) === "rep" ? "REP" : "—"}</td>
                    <td className="px-3 py-2.5 text-right">{r.leads.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right">{r.won.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right">{r.winRate.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right">{r.touchesToWin == null ? "—" : r.touchesToWin.toFixed(1)}</td>
                    <td className="px-3 py-2.5 text-right">{r.daysToClose == null ? "—" : r.daysToClose}</td>
                    <td className="px-3 py-2.5 text-right">{formatBandUsd(r.mrrWonCents)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        {r.trendPct != null && (
                          <span className={cn("text-[11px]", r.trendPct > 0 ? "text-status-success" : r.trendPct < 0 ? "text-status-danger" : "text-text-subtle")}>
                            {r.trendPct > 0 ? "+" : ""}{r.trendPct}%
                          </span>
                        )}
                        {formatBandUsd(r.yieldCents)}
                      </span>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={TABLE_COLS.length} className="px-3 py-6 text-center text-text-subtle">No leads in this window and scope.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-strong text-right font-medium text-text-default">
                  <td className="px-3 py-3 text-left text-eyebrow uppercase tracking-wide text-text-subtle">Blended</td>
                  <td />
                  <td className="px-3 py-3">{t.leads.toLocaleString()}</td>
                  <td className="px-3 py-3">{t.won.toLocaleString()}</td>
                  <td className="px-3 py-3">{t.winRate.toFixed(1)}%</td>
                  <td /><td />
                  <td className="px-3 py-3">{formatBandUsd(t.mrrWonCents)}</td>
                  <td className="px-3 py-3">{formatBandUsd(t.yieldCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {/* Scatter + rules */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card padding="lg" shadow="sm">
            <div className="mb-3">
              <h2 className="text-body-strong text-text-default">Win rate against touches to win</h2>
              <p className="text-caption text-text-muted">Bubble area is lead volume. Up and to the left wins more often with fewer touches.</p>
            </div>
            <Scatter rows={perf.rows} />
          </Card>
          <Card padding="lg" shadow="sm">
            <h2 className="text-body-strong text-text-default">What this report assumes</h2>
            <ul className="mt-2 flex flex-col">
              {RULES.map((r) => (
                <li key={r.title} className="border-b border-border-subtle py-2.5 last:border-b-0">
                  <span className="text-body-sm font-medium text-text-default">{r.title}</span>
                  <p className="text-caption text-text-muted">{r.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-radius-md border px-3.5 py-2.5 text-caption text-text-muted", tone === "warn" ? "border-status-warning/40 bg-status-warning-bg" : "border-border-subtle bg-surface-sunken")}>
      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", tone === "warn" ? "bg-status-warning" : "bg-text-muted")} aria-hidden />
      <p className="[&_b]:font-medium [&_b]:text-text-default">{children}</p>
    </div>
  );
}

export default LeadSourceReport;
