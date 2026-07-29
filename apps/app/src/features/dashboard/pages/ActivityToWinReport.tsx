/**
 * Activity-To-Win report. Deal outcome is the top-level control: the "Where the
 * effort went" band scopes the whole report to All / Won / Lost / Open, and the
 * KPI cards, rep table, and drilldown all re-read through that lens. Restyled to
 * match the design prototype (artifact a932ebf4). Route: /dashboard/activity-to-win.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Button } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useAuth } from "@/stores/auth";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useOrgMemberNames } from "../hooks/useOrgMemberNames";
import { resolveRange, type RangeKey } from "../lib/dateRange";
import { formatBandUsd } from "../lib/activityToWin";
import type { OutcomeBand, ReportScope } from "../lib/unifiedActivityReport";
import {
  buildDealPerf, repPerf, grandPerf, bandFromRows, scopeKpis,
  rankReps, repCell, wonVsLost, REP_COLUMNS, type RepSortKey,
} from "../lib/activityPerformance";
import { activityPerfCsv } from "../lib/activityPerfCsv";
import { AllocationBand } from "../components/AllocationBand";
import { ScopeMetricStrip } from "../components/ScopeMetricStrip";

const SCOPE_KEYS: ReportScope[] = ["all", "won", "lost", "open"];
const REPORT_RANGES: { key: RangeKey; label: string }[] = [
  { key: "30d", label: "Last 30 Days" }, { key: "90d", label: "Last 90 Days" },
  { key: "6mo", label: "Last 6 Months" }, { key: "all", label: "All Time" },
];
const RANGE_WORDS: Record<RangeKey, string> = {
  "7d": "7 days", "30d": "30 days", "90d": "90 days", "6mo": "6 months", "all": "",
};
const MIX_COLORS: { key: "call" | "email" | "drop_in" | "appointment"; cls: string }[] = [
  { key: "call", cls: "bg-accent-blue" }, { key: "email", cls: "bg-accent-teal" },
  { key: "drop_in", cls: "bg-accent-violet" }, { key: "appointment", cls: "bg-accent-orange" },
];
const OUTCOME_DOT: Record<"won" | "open" | "lost", string> = {
  won: "bg-accent-teal", open: "bg-accent-blue", lost: "bg-accent-pink",
};

const SORT_OPTIONS: Record<ReportScope, { key: RepSortKey; label: string }[]> = {
  all: [{ key: "activity", label: "Activity volume" }, { key: "value", label: "Revenue won" }],
  won: [{ key: "value", label: "Outcome value" }, { key: "activity", label: "Activity volume" }, { key: "primary", label: "Deal count" }],
  lost: [{ key: "value", label: "Outcome value" }, { key: "activity", label: "Activity volume" }, { key: "primary", label: "Deal count" }],
  open: [{ key: "value", label: "Outcome value" }, { key: "activity", label: "Activity volume" }, { key: "primary", label: "Deal count" }],
};

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export function ActivityToWinReport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = useProfile().data?.role;
  const isManagerish = role === "manager" || role === "admin";
  const memberNames = useOrgMemberNames(isManagerish);
  const userId = useAuth((s) => s.user?.id);
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();

  const paramScope = searchParams.get("scope");
  const initialScope: ReportScope = SCOPE_KEYS.includes(paramScope as ReportScope) ? (paramScope as ReportScope) : "won";
  const [scope, setScope] = React.useState<ReportScope>(initialScope);
  const [windowKey, setWindowKey] = React.useState<RangeKey>("90d");
  const [sortKey, setSortKey] = React.useState<RepSortKey>("value");
  const [showCmp, setShowCmp] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());

  const range = React.useMemo(() => resolveRange(windowKey, new Date()), [windowKey]);

  const repName = React.useCallback((ownerId: string | null): string => {
    if (!ownerId) return "Unassigned";
    if (ownerId === userId) return "You";
    return memberNames.get(ownerId) ?? "Unassigned";
  }, [memberNames, userId]);

  const rows = React.useMemo(() => buildDealPerf(activities, deals, range), [activities, deals, range]);
  const reps = React.useMemo(() => repPerf(rows), [rows]);
  const grand = React.useMemo(() => grandPerf(reps), [reps]);
  const band = React.useMemo<OutcomeBand>(() => bandFromRows(rows), [rows]);
  const kpis = React.useMemo(() => scopeKpis(grand, rows, scope), [grand, rows, scope]);

  const options = SORT_OPTIONS[scope];
  const activeSort: RepSortKey = options.some((o) => o.key === sortKey) ? sortKey : options[0]!.key;
  const ranked = React.useMemo(() => rankReps(reps, scope, activeSort), [reps, scope, activeSort]);
  const cols = REP_COLUMNS[scope];
  const gridStyle: React.CSSProperties = { gridTemplateColumns: `minmax(150px,2fr) repeat(${cols.length}, minmax(72px,1fr))` };

  const toggleRow = (id: string) => setExpanded((cur) => {
    const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const rangePhrase = windowKey === "all" ? "all-time" : `in the last ${RANGE_WORDS[windowKey]}`;
  const subtitle: React.ReactNode = scope === "won"
    ? (<>Deals <b className="font-medium text-white">closed won</b> {rangePhrase}, with full activity history</>)
    : scope === "lost"
      ? (<>Deals <b className="font-medium text-white">closed lost</b> {rangePhrase}, with full activity history</>)
      : scope === "open"
        ? (<>Companies with <b className="font-medium text-white">open</b> deals touched {rangePhrase}</>)
        : (<>Activity logged {rangePhrase}</>);

  const nonWon = grand.act - grand.wonAct;
  const cmp = React.useMemo(() => wonVsLost(rows), [rows]);
  const handleExport = () => downloadCsv(activityPerfCsv(rows, scope, repName), `activity-to-win-${scope}-${range.toIso.slice(0, 10)}.csv`);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        <div className="relative overflow-hidden rounded-radius-md bg-gradient-to-br from-brand-gradient-from via-brand-gradient-via to-brand-gradient-to p-6 text-white sm:p-8 dark:before:pointer-events-none dark:before:absolute dark:before:inset-0 dark:before:rounded-[inherit] dark:before:bg-black/30 dark:before:content-['']">
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <button type="button" onClick={() => navigate("/dashboard")} className="inline-flex w-fit items-center gap-1 text-caption text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
              </button>
              <p className="text-eyebrow uppercase tracking-[0.16em] text-white/70">navigatr reporting</p>
              <h1 className="text-heading-lg text-white">Activity-To-Win</h1>
              <p className="text-body-sm text-white/80">{subtitle}</p>
            </div>
            <div className="relative flex flex-wrap gap-1.5">
              {REPORT_RANGES.map((r) => (
                <button key={r.key} type="button" onClick={() => setWindowKey(r.key)}
                  className={cn("rounded-radius-full px-3 py-1.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                    windowKey === r.key ? "bg-white text-brand-primary" : "bg-white/15 text-white/90 hover:bg-white/25")}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <AllocationBand band={band} scope={scope} onScope={setScope} />

        {band.total === 0 ? (
          <Card padding="lg" shadow="sm"><p className="text-body-sm text-text-muted">No activity logged in this window. Try a longer window.</p></Card>
        ) : (
          <>
            <ScopeMetricStrip cards={kpis} />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-caption text-text-muted">
                Sort by
                <select value={activeSort} onChange={(e) => setSortKey(e.target.value as RepSortKey)}
                  className="rounded-radius-sm border border-border-default bg-surface-default px-2.5 py-1.5 text-caption text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
                  {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </label>
              {scope === "won" && (
                <label className="flex cursor-pointer select-none items-center gap-2 text-caption text-text-muted">
                  <button type="button" role="switch" aria-checked={showCmp} onClick={() => setShowCmp((v) => !v)}
                    className={cn("relative h-5 w-9 shrink-0 rounded-radius-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                      showCmp ? "border-accent-teal bg-accent-teal/25" : "border-border-default bg-surface-sunken")}>
                    <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-radius-full transition-[left]", showCmp ? "left-4 bg-accent-teal" : "left-0.5 bg-text-subtle")} />
                  </button>
                  Compare won against lost
                </label>
              )}
            </div>

            <Card padding="none" shadow="sm">
              <div className="hidden border-b border-border-subtle px-4 sm:grid sm:items-center sm:gap-2.5 sm:py-2.5" style={gridStyle}>
                <span className="text-eyebrow uppercase tracking-wide text-text-subtle">Rep</span>
                {cols.map((c) => <span key={c.key} className="text-right text-eyebrow uppercase tracking-wide text-text-subtle">{c.label}</span>)}
              </div>

              {ranked.length === 0 ? (
                <p className="px-4 py-6 text-center text-body-sm text-text-muted">No activity in this scope.</p>
              ) : (
                <div className="flex flex-col">
                  {ranked.map(({ rep, rank, badge }) => {
                    const k = rep.ownerId ?? "__unassigned__";
                    const isOpen = expanded.has(k);
                    const drillRows = [...rep.deals].filter((d) => scope === "all" || d.outcome === scope).sort((a, b) => b.valueCents - a.valueCents);
                    return (
                      <div key={k} className="border-t border-border-subtle first:border-t-0">
                        <button type="button" onClick={() => toggleRow(k)} aria-expanded={isOpen}
                          className="grid w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary" style={gridStyle}>
                          <span className="flex min-w-0 items-center gap-2.5">
                            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-text-subtle transition-transform", isOpen && "rotate-90")} aria-hidden />
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-caption text-text-muted">{rank}</span>
                            <span className="truncate text-body-md text-text-default">{repName(rep.ownerId)}</span>
                            {badge && (
                              <span className={cn("shrink-0 rounded-radius-sm px-1.5 py-0.5 text-[10.5px] font-medium",
                                badge.kind === "warn" ? "bg-status-warning-bg text-status-warning" : "bg-status-success-bg text-status-success")}>
                                {badge.text}
                              </span>
                            )}
                            <span className="ml-1 hidden h-1.5 min-w-[52px] shrink-0 gap-px overflow-hidden rounded-radius-full sm:flex" aria-hidden title="Call, email, visit, appointment mix">
                              {MIX_COLORS.map((m) => <i key={m.key} className={cn("block h-full", m.cls)} style={{ flexGrow: rep.mix[m.key] || 0.001, flexBasis: 0 }} />)}
                            </span>
                          </span>
                          {cols.map((c) => <span key={c.key} className="text-right text-body-md tabular-nums text-text-default">{repCell(rep, c.key)}</span>)}
                        </button>

                        {isOpen && (
                          <div className="overflow-x-auto bg-surface-sunken px-4 pb-3 pt-1">
                            <table className="w-full min-w-[560px] text-caption">
                              <thead>
                                <tr className="text-right text-eyebrow uppercase tracking-wide text-text-subtle">
                                  <th className="py-2 text-left font-normal">Company</th>
                                  <th className="font-normal">Calls</th><th className="font-normal">Emails</th><th className="font-normal">Visits</th><th className="font-normal">Appts</th>
                                  <th className="font-medium text-text-muted">Total</th><th className="font-normal">Days</th><th className="font-normal">Value</th><th className="font-normal">Status</th>
                                </tr>
                              </thead>
                              <tbody className="tabular-nums text-text-muted">
                                {drillRows.length === 0 ? (
                                  <tr><td colSpan={9} className="py-3 text-center text-text-subtle">No companies in this scope.</td></tr>
                                ) : drillRows.map((d) => (
                                  <tr key={d.dealId} className="border-t border-border-subtle text-right">
                                    <td className="py-2 text-left text-text-default">{d.companyName}</td>
                                    <td>{d.counts.call}</td><td>{d.counts.email}</td><td>{d.counts.drop_in}</td><td>{d.counts.appointment}</td>
                                    <td className="font-medium text-text-default">{d.counts.total}</td>
                                    <td>{d.days != null ? d.days : <span className="text-text-subtle">open</span>}</td>
                                    <td>{formatBandUsd(d.valueCents)}</td>
                                    <td>
                                      <span className="inline-flex items-center justify-end gap-1.5">
                                        <span className={cn("h-1.5 w-1.5 rounded-radius-full", OUTCOME_DOT[d.outcome])} aria-hidden />
                                        {d.outcome}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {scope === "won" && showCmp && (
                    <div className="overflow-x-auto border-t border-border-subtle bg-surface-sunken px-4 pb-3 pt-1">
                      <table className="w-full min-w-[420px] text-caption">
                        <thead>
                          <tr className="text-right text-eyebrow uppercase tracking-wide text-text-subtle">
                            <th className="py-2 text-left font-normal">Average per deal</th>
                            <th className="font-normal">Calls</th><th className="font-normal">Emails</th><th className="font-normal">Visits</th><th className="font-normal">Appts</th><th className="font-normal">Days</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums text-text-muted">
                          {([["won", cmp.won], ["lost", cmp.lost]] as const).map(([label, c]) => (
                            <tr key={label} className="border-t border-border-subtle text-right">
                              <td className="py-2 text-left">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className={cn("h-1.5 w-1.5 rounded-radius-full", OUTCOME_DOT[label])} aria-hidden />
                                  {label === "won" ? "Won" : "Lost"}
                                </span>
                              </td>
                              <td>{c.calls.toFixed(1)}</td><td>{c.emails.toFixed(1)}</td><td>{c.visits.toFixed(1)}</td><td>{c.appts.toFixed(1)}</td>
                              <td>{c.days != null ? c.days.toFixed(1) : "n/a"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <div className="rounded-radius-md border border-border-subtle bg-surface-sunken px-4 py-3 text-caption text-text-muted">
              <span className="font-medium text-text-default">Reconciliation.</span> {grand.act} activities logged,{" "}
              {grand.wonAct} attributed to a won deal, {nonWon} sitting against open or lost work, 0 logged with no company or deal attached.
              {" "}Touches per win uses all {grand.act} activities as the numerator, not just the {grand.wonAct} on winners.
            </div>

            <div className="flex">
              <Button variant="secondary" size="sm" className="ml-auto" onClick={handleExport}>
                <Download className="h-4 w-4" aria-hidden /> Export CSV
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ActivityToWinReport;
