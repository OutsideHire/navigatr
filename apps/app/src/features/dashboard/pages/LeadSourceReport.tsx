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
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useAuth } from "@/stores/auth";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { leadSourceSetBy, leadSourceColor, type LeadSource } from "@/features/pipeline/lib/leadSources";
import { useOrgMemberNames } from "../hooks/useOrgMemberNames";
import { formatBandUsd } from "../lib/activityToWin";
import { LeadSourceFlow } from "../components/LeadSourceFlow";
import { LeadSourceEfficiency } from "../components/LeadSourceEfficiency";
import {
  computeLeadSourcePerformance,
  leadSourceDetail,
  type AttributionBasis,
  type SourceScope,
  type LeadSourceRow,
  type LeadSourceDetail,
} from "../lib/leadSourcePerformance";

const WINDOWS = [30, 90, 180] as const;
const colorOf = (s: string) => leadSourceColor(s);

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
  const [openSource, setOpenSource] = React.useState<LeadSource | null>(null);
  // Controlled highlight shared by the signature flow (hover-driven); selection
  // opens the per-source drawer.
  const [activeSource, setActiveSource] = React.useState<string | null>(null);

  const role = useProfile().data?.role;
  const isManagerish = role === "manager" || role === "admin";
  const memberNames = useOrgMemberNames(isManagerish);
  const userId = useAuth((s) => s.user?.id);
  const repName = React.useCallback(
    (ownerId: string | null) => (!ownerId ? "Unassigned" : ownerId === userId ? "You" : memberNames.get(ownerId) ?? "Rep"),
    [memberNames, userId],
  );

  const detail = React.useMemo(
    () => (openSource ? leadSourceDetail(deals, activities, { source: openSource, now: new Date(), windowDays }) : null),
    [openSource, deals, activities, windowDays],
  );

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
          <LeadSourceFlow
            data={perf.rows.map((r) => ({
              sourceId: r.source,
              label: r.label,
              color: colorOf(r.source),
              leads: r.leads,
              wonRevenue: r.mrrWonCents,
            }))}
            activeSourceId={activeSource}
            onHoverSource={setActiveSource}
            onSelectSource={(id) => {
              if (id !== "other_sources") setOpenSource(id as LeadSource);
            }}
          />
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
                  <tr
                    key={r.source}
                    tabIndex={0}
                    onClick={() => setOpenSource(r.source)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenSource(r.source); } }}
                    className={cn(
                      "cursor-pointer border-b border-border-subtle hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary",
                      !r.repSourced && "text-text-muted",
                    )}
                  >
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
            <LeadSourceEfficiency
              data={perf.rows.map((r) => ({
                sourceId: r.source,
                label: r.label,
                shortLabel: r.label.split(" ")[0].toUpperCase(),
                color: colorOf(r.source),
                leads: r.leads,
                wonDeals: r.won,
                winRate: r.winRate,
                touchesToWin: r.touchesToWin ?? 0,
                belowFloor: r.won > 0 && r.won < 5,
              }))}
              activeSourceId={activeSource}
              onHoverSource={setActiveSource}
              onSelectSource={(id) => setOpenSource(id as LeadSource)}
            />
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

        {detail && <SourceDrawer detail={detail} onClose={() => setOpenSource(null)} repName={repName} />}
      </div>
    </div>
  );
}

function SourceDrawer({ detail, onClose, repName }: { detail: LeadSourceDetail; onClose: () => void; repName: (id: string | null) => string }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const maxCohort = Math.max(1, ...detail.cohorts.map((c) => c.leads));
  return (
    <>
      <button type="button" aria-label="Close panel" onClick={onClose} className="fixed inset-0 z-40 bg-black/40" />
      <aside role="dialog" aria-modal="true" aria-label={`${detail.label} detail`} className="fixed inset-y-0 right-0 z-50 flex w-[min(480px,94vw)] flex-col border-l border-border-strong bg-surface-default shadow-card-hover">
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div>
            <p className="text-eyebrow uppercase tracking-wide text-text-subtle">{detail.setBy === "system" ? "System set source" : detail.setBy === "rep" ? "Rep set source" : "Source"}</p>
            <h3 className="text-heading-sm text-text-default">{detail.label}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-body-sm text-text-muted">{detail.blurb}</p>

          <div className="mb-6 grid grid-cols-3 gap-2">
            {[
              { k: "Win rate", v: `${detail.winRate.toFixed(1)}%` },
              { k: "Touches", v: detail.touchesToWin == null ? "—" : detail.touchesToWin.toFixed(1) },
              { k: "MRR / lead", v: formatBandUsd(detail.yieldCents) },
            ].map((s) => (
              <div key={s.k} className="rounded-radius-md border border-border-subtle p-2.5">
                <div className="text-eyebrow uppercase tracking-wide text-text-subtle">{s.k}</div>
                <div className="text-body-strong tabular-nums text-text-default">{s.v}</div>
              </div>
            ))}
          </div>

          <div className="mb-6">
            <h4 className="mb-2 text-eyebrow uppercase tracking-wide text-text-subtle">Stage funnel</h4>
            <div className="flex flex-col gap-1.5">
              {detail.funnel.map((f) => (
                <div key={f.label} className="grid grid-cols-[88px_1fr_92px] items-center gap-2 text-caption">
                  <span className="text-text-muted">{f.label}</span>
                  <span className="h-4 rounded-radius-sm bg-brand-primary" style={{ width: `${Math.max(2, f.pct)}%` }} aria-hidden />
                  <span className="text-right tabular-nums text-text-muted">{f.count.toLocaleString()} · {f.pct.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <h4 className="mb-2 text-eyebrow uppercase tracking-wide text-text-subtle">Monthly cohorts, leads created and win rate</h4>
            <div className="flex h-28 items-end gap-2">
              {detail.cohorts.map((c) => (
                <div key={c.label} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-caption tabular-nums text-text-subtle">{c.winRate.toFixed(0)}%</span>
                  <div className="w-full rounded-t-radius-sm bg-brand-primary" style={{ height: `${Math.max(2, (c.leads / maxCohort) * 72)}px`, opacity: c.open ? 0.4 : 0.85 }} aria-hidden />
                  <span className="text-caption text-text-subtle">{c.label}</span>
                  {c.open && <span className="text-[9px] uppercase text-status-warning">open</span>}
                </div>
              ))}
            </div>
            <p className="mt-2 text-caption text-text-subtle">Shaded bars are cohorts still inside their median time to close.</p>
          </div>

          <div>
            <h4 className="mb-2 text-eyebrow uppercase tracking-wide text-text-subtle">Rep breakdown, ranked by yield</h4>
            <table className="w-full text-caption">
              <thead>
                <tr className="text-right text-eyebrow uppercase tracking-wide text-text-subtle">
                  <th className="py-1 text-left font-normal">Rep</th>
                  <th className="font-normal">Leads</th><th className="font-normal">Won</th><th className="font-normal">Win rate</th><th className="font-normal">MRR / lead</th>
                </tr>
              </thead>
              <tbody className="tabular-nums text-text-muted">
                {detail.reps.length === 0 ? (
                  <tr><td colSpan={5} className="py-3 text-center text-text-subtle">No reps for this source.</td></tr>
                ) : detail.reps.map((r) => (
                  <tr key={r.ownerId ?? "unassigned"} className="border-t border-border-subtle text-right">
                    <td className="py-2 text-left text-text-default">{repName(r.ownerId)}</td>
                    <td>{r.leads}</td><td>{r.won}</td><td>{r.winRate.toFixed(1)}%</td><td>{formatBandUsd(r.yieldCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </>
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
