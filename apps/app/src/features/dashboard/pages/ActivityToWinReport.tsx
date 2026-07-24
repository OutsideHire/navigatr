/**
 * Activity performance report (unified, Phase 1). One report where deal outcome
 * is the top-level control: pick All / Won / Lost / Open and the same
 * rep -> company -> activity view re-reads through that lens. Phase 1 windows on
 * activity date for every scope so the band, table, and footer reconcile;
 * close-date anchoring for won/lost is a Phase 2 correction. Route:
 * /dashboard/activity-to-win.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Button } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useAuth } from "@/stores/auth";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useOrgMemberNames } from "../hooks/useOrgMemberNames";
import { resolveRange, type RangeKey } from "../lib/dateRange";
import { formatBandUsd } from "../lib/activityToWin";
import {
  outcomeBand, attributeActivitiesWithOutcome, unifiedRepRows, unifiedMetricStrip,
  rankDivergence, reconciliation, type ReportScope, type UnifiedRepRow,
} from "../lib/unifiedActivityReport";
import { unifiedActivityCsv } from "../lib/unifiedActivityCsv";
import { AllocationBand } from "../components/AllocationBand";
import { ScopeMetricStrip } from "../components/ScopeMetricStrip";

const SCOPES: { key: ReportScope; label: string }[] = [
  { key: "all", label: "All" }, { key: "won", label: "Won" }, { key: "lost", label: "Lost" }, { key: "open", label: "Open" },
];
const REPORT_RANGES: { key: RangeKey; label: string }[] = [
  { key: "30d", label: "Last 30 Days" }, { key: "90d", label: "Last 90 Days" },
  { key: "6mo", label: "Last 6 Months" }, { key: "all", label: "All Time" },
];
const RANGE_PHRASE: Record<RangeKey, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "6mo": "6 months", "all": "" };
const MIX: { key: "call" | "email" | "drop_in" | "appointment"; cls: string }[] = [
  { key: "call", cls: "bg-accent-blue" }, { key: "email", cls: "bg-accent-violet" },
  { key: "drop_in", cls: "bg-accent-teal" }, { key: "appointment", cls: "bg-accent-orange" },
];
type SortKey = "value" | "activity" | "deals";
const SCOPE_KEYS: ReportScope[] = ["all", "won", "lost", "open"];

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

const keyOf = (id: string | null) => id ?? "__unassigned__";

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
  const [sortKey, setSortKey] = React.useState<SortKey>("value");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());

  const range = React.useMemo(() => resolveRange(windowKey, new Date()), [windowKey]);

  const repName = React.useCallback((ownerId: string | null): string => {
    if (!ownerId) return "Unassigned";
    if (ownerId === userId) return "You";
    return memberNames.get(ownerId) ?? "Unassigned";
  }, [memberNames, userId]);

  const band = React.useMemo(() => outcomeBand(attributeActivitiesWithOutcome(activities, deals, range)), [activities, deals, range]);
  const metrics = React.useMemo(() => unifiedMetricStrip(activities, deals, range, scope), [activities, deals, range, scope]);
  const reps = React.useMemo(() => unifiedRepRows(activities, deals, range, scope), [activities, deals, range, scope]);
  const divergence = React.useMemo(() => rankDivergence(reps), [reps]);
  const recon = reconciliation(band);

  const sortedReps = React.useMemo(() => {
    const val = (r: UnifiedRepRow) => (sortKey === "value" ? r.valueCents : sortKey === "deals" ? r.dealCount : r.counts.total);
    return [...reps].sort((a, b) => val(b) - val(a) || repName(a.ownerId).localeCompare(repName(b.ownerId)));
  }, [reps, sortKey, repName]);

  const toggle = (id: string) => setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const windowLabel = windowKey === "all" ? "All-time activity" : `Activity logged in the last ${RANGE_PHRASE[windowKey]}`;
  const handleExport = () => downloadCsv(unifiedActivityCsv(sortedReps, repName), `activity-performance-${scope}-${range.toIso.slice(0, 10)}.csv`);

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        <div className="relative overflow-hidden rounded-radius-md bg-gradient-to-br from-brand-gradient-from via-brand-gradient-via to-brand-gradient-to p-6 text-white sm:p-8 dark:before:pointer-events-none dark:before:absolute dark:before:inset-0 dark:before:rounded-[inherit] dark:before:bg-black/30 dark:before:content-['']">
          <div className="relative flex flex-col gap-1">
            <button type="button" onClick={() => navigate("/dashboard")} className="inline-flex w-fit items-center gap-1 text-caption text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
            </button>
            <h1 className="text-heading-lg text-white">Activity performance</h1>
            <p className="text-body-sm text-white/80">{windowLabel}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SCOPES.map((s) => (
              <button key={s.key} type="button" onClick={() => setScope(s.key)} aria-pressed={scope === s.key}
                className={cn("rounded-radius-full px-3 py-1.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                  scope === s.key ? "bg-brand-primary text-white" : "bg-surface-sunken text-text-muted hover:text-text-default")}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {REPORT_RANGES.map((r) => (
              <button key={r.key} type="button" onClick={() => setWindowKey(r.key)}
                className={cn("rounded-radius-full px-3 py-1.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                  windowKey === r.key ? "bg-brand-primary text-white" : "bg-surface-sunken text-text-muted hover:text-text-default")}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <AllocationBand band={band} scope={scope} onScope={setScope} />

        {band.total === 0 ? (
          <Card padding="lg" shadow="sm"><p className="text-body-sm text-text-muted">No activity logged in this window. Try a longer window.</p></Card>
        ) : (
          <>
            <ScopeMetricStrip metrics={metrics} />

            <Card padding="none" shadow="sm">
              <div className="flex items-center justify-between gap-3 px-4 pt-4">
                <h2 className="text-heading-sm text-text-default">By rep</h2>
                <div className="flex gap-1.5 text-caption">
                  {(["value", "activity", "deals"] as SortKey[]).map((k) => (
                    <button key={k} type="button" onClick={() => setSortKey(k)} aria-pressed={sortKey === k}
                      className={cn("rounded-radius-full px-2.5 py-1", sortKey === k ? "bg-surface-sunken text-text-default" : "text-text-muted hover:text-text-default")}>
                      {k === "value" ? "Value" : k === "activity" ? "Activity" : "Deals"}
                    </button>
                  ))}
                </div>
              </div>
              {sortedReps.length === 0 ? (
                <p className="px-4 pb-4 pt-2 text-body-sm text-text-muted">
                  No {scope === "all" ? "activity" : `${scope} activity`} in this window.
                </p>
              ) : (
                <div className="mt-2 flex flex-col">
                  {sortedReps.map((rep) => {
                    const k = keyOf(rep.ownerId);
                    const isOpen = expanded.has(k);
                    const div = divergence.get(k);
                    return (
                      <div key={k} className="border-t border-border-subtle">
                        <button type="button" onClick={() => toggle(k)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
                          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-text-subtle" /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-body-strong text-text-default">{repName(rep.ownerId)}</span>
                              {div && <span className="shrink-0 rounded-radius-full border border-border-subtle px-2 py-0.5 text-caption text-text-muted">effort {div.effortRank} / outcome {div.outcomeRank}</span>}
                            </div>
                            <div className="mt-1 flex items-center gap-1" aria-hidden>
                              {MIX.map((m) => (rep.counts[m.key] > 0 ? <span key={m.key} className={cn("h-1.5 w-1.5 rounded-radius-full", m.cls)} /> : null))}
                            </div>
                          </div>
                          <div className="hidden gap-6 text-right sm:flex">
                            <div><div className="text-caption text-text-muted">Deals</div><div className="tabular-nums text-text-default">{rep.dealCount}</div></div>
                            <div><div className="text-caption text-text-muted">Touches</div><div className="tabular-nums text-text-default">{rep.counts.total}</div></div>
                            <div><div className="text-caption text-text-muted">Value</div><div className="tabular-nums text-text-default">{formatBandUsd(rep.valueCents)}</div></div>
                          </div>
                        </button>
                        {isOpen && (
                          <div className="overflow-x-auto px-4 pb-3">
                            <table className="w-full min-w-[520px] text-caption">
                              <thead>
                                <tr className="text-right text-text-muted">
                                  <th className="py-1 text-left font-normal">Company</th>
                                  <th className="font-normal">Calls</th><th className="font-normal">Emails</th><th className="font-normal">Visits</th><th className="font-normal">Appts</th>
                                  <th className="font-medium text-text-default">Total</th><th className="font-normal">Deals</th><th className="font-normal">Value</th>
                                </tr>
                              </thead>
                              <tbody className="text-text-default tabular-nums">
                                {rep.companies.map((c) => (
                                  <tr key={c.companyName} className="text-right">
                                    <td className="py-1 text-left text-text-muted">{c.companyName}</td>
                                    <td>{c.counts.call}</td><td>{c.counts.email}</td><td>{c.counts.drop_in}</td><td>{c.counts.appointment}</td>
                                    <td className="font-medium">{c.counts.total}</td><td>{c.dealCount}</td><td>{formatBandUsd(c.valueCents)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <div className="rounded-radius-md border border-border-subtle bg-surface-sunken px-4 py-3 text-caption text-text-muted">
              <span className="font-medium text-text-default">Reconciliation:</span> {recon.total} logged · {recon.won} on won · {recon.openLost} on open or lost · {recon.unattached} unattached.
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
