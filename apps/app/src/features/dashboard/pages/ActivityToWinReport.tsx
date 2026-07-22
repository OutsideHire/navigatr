/**
 * Activities Report — Closed Won deal activity analysis (US-01..US-09).
 * Restyle of the Activity-to-Win drill-down into the dashboard's Activities
 * Report: gradient header, salesperson + time-period filters, average-based
 * KPI cards, a salesperson performance ranking, average-activities-by-type,
 * a sortable deal-details table, and auto Key Insights. The already-shipped
 * extras (month trend, Compare-to-Lost, source/value-band filters, CSV export)
 * are kept below as secondary controls. Averages here by design; the dashboard
 * AW widget stays median-based. "Visits" = the dropin activity type. Reps see
 * their own deals (RLS + Rep column hidden); managers see their team.
 * Route: /dashboard/activity-to-win.
 */

import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowUp, ArrowDown, Download, Trophy, Activity, Zap, DollarSign,
  Phone, Mail, MapPin, CalendarDays,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Select, Badge, Button, Checkbox } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useOrganization } from "@/features/auth/useOrganization";
import { useAuth } from "@/stores/auth";
import { useOrgMemberNames } from "../hooks/useOrgMemberNames";
import { useActivityToWin, useActivityToLost } from "../hooks/useActivityToWin";
import {
  buildValueBands, activityToWinTrend, activityToWinRowsToCsv, formatBandUsd,
  type AwFilters, type AwTrendBucket, type AwActivityType,
} from "../lib/activityToWin";
import {
  activitiesReportKpis, salespersonRanking, avgActivitiesByType,
  activitiesReportInsights, sortReportRows,
  type ReportSortColumn, type SortDir,
} from "../lib/activitiesReport";
import { resolveRange, type RangeKey } from "../lib/dateRange";

function fmt(n: number | null): string {
  if (n == null) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ── Month-trend mini chart (kept from the prior report) ──────────────────
function TrendMiniChart({
  title, buckets, valueOf,
}: {
  title: string;
  buckets: AwTrendBucket[];
  valueOf: (b: AwTrendBucket) => number | null;
}) {
  const values = buckets.map(valueOf);
  const max = Math.max(1, ...values.filter((v): v is number => v != null));
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-2">
      <span className="text-caption uppercase tracking-wide text-text-muted">{title}</span>
      <div className="flex h-24 items-end gap-2" role="img" aria-label={title}>
        {buckets.map((b) => {
          const v = valueOf(b);
          const heightPct = v == null ? 0 : Math.max(6, Math.round((v / max) * 100));
          return (
            <div key={b.key} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-caption tabular-nums leading-none text-text-default">{fmt(v)}</span>
              <div className="flex w-full max-w-[40px] flex-1 items-end">
                {v == null ? (
                  <div className="h-px w-full bg-border-subtle" />
                ) : (
                  <div className="w-full rounded-t-radius-sm bg-brand-primary" style={{ height: `${heightPct}%` }} />
                )}
              </div>
              <span className="text-caption text-text-subtle">{b.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── KPI card ─────────────────────────────────────────────────────────────
const ACCENT: Record<"blue" | "violet" | "teal" | "orange", { bg: string; fg: string }> = {
  blue: { bg: "bg-accent-blue-20", fg: "text-accent-blue" },
  violet: { bg: "bg-accent-violet-20", fg: "text-accent-violet" },
  teal: { bg: "bg-accent-teal-20", fg: "text-accent-teal" },
  orange: { bg: "bg-accent-orange-20", fg: "text-accent-orange" },
};

function ReportKpi({
  icon: Icon, accent, label, value, sub,
}: {
  icon: LucideIcon;
  accent: keyof typeof ACCENT;
  label: string;
  value: string;
  sub?: string;
}) {
  const a = ACCENT[accent];
  return (
    <Card padding="md" shadow="sm">
      <div className="flex items-start gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md", a.bg, a.fg)} aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption uppercase tracking-wide text-text-muted">{label}</span>
          <span className="truncate text-heading-sm tabular-nums text-text-default">{value}</span>
          {sub && <span className="truncate text-caption text-text-muted">{sub}</span>}
        </div>
      </div>
    </Card>
  );
}

// ── Time-period pills + table columns ────────────────────────────────────
const REPORT_RANGES: { key: RangeKey; label: string }[] = [
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "6mo", label: "Last 6 Months" },
  { key: "all", label: "All Time" },
];

const TYPE_META: { key: AwActivityType; label: string; icon: LucideIcon; accent: keyof typeof ACCENT }[] = [
  { key: "call", label: "Calls", icon: Phone, accent: "blue" },
  { key: "email", label: "Emails", icon: Mail, accent: "violet" },
  { key: "dropin", label: "Visits", icon: MapPin, accent: "teal" },
  { key: "appointment", label: "Appointments", icon: CalendarDays, accent: "orange" },
];

const TABLE_COLUMNS: { key: ReportSortColumn; label: string; numeric?: boolean }[] = [
  { key: "company", label: "Company" },
  { key: "value", label: "Value", numeric: true },
  { key: "call", label: "Calls", numeric: true },
  { key: "email", label: "Emails", numeric: true },
  { key: "dropin", label: "Visits", numeric: true },
  { key: "appointment", label: "Appts", numeric: true },
  { key: "total", label: "Total", numeric: true },
  { key: "days", label: "Days", numeric: true },
];

const SOURCE_ALL = "__all__";
const BAND_ANY = "__any__";
const OWNER_ALL = "__all__";
const UNASSIGNED = "__unassigned__";

export function ActivityToWinReport() {
  const navigate = useNavigate();
  const role = useProfile().data?.role;
  const isManagerish = role === "manager" || role === "admin";
  const memberNames = useOrgMemberNames(isManagerish);
  const userId = useAuth((s) => s.user?.id);

  const [windowKey, setWindowKey] = React.useState<RangeKey>("90d");
  const [source, setSource] = React.useState<string>(SOURCE_ALL);
  const [bandKey, setBandKey] = React.useState<string>(BAND_ANY);
  const [ownerKey, setOwnerKey] = React.useState<string>(OWNER_ALL);
  const [compareLost, setCompareLost] = React.useState(false);
  const [sort, setSort] = React.useState<{ column: ReportSortColumn; dir: SortDir }>({ column: "value", dir: "desc" });

  const range = React.useMemo(() => resolveRange(windowKey, new Date()), [windowKey]);

  const org = useOrganization();
  const bands = React.useMemo(
    () => buildValueBands(org.data?.valueBandLowCents, org.data?.valueBandHighCents),
    [org.data?.valueBandLowCents, org.data?.valueBandHighCents],
  );

  const filters = React.useMemo<AwFilters>(() => {
    const band = bands.find((b) => b.key === bandKey);
    return {
      source: source === SOURCE_ALL ? undefined : source,
      valueBand: band ? { minCents: band.minCents, maxCents: band.maxCents } : undefined,
    };
  }, [source, bandKey, bands]);

  const windowOnly = useActivityToWin(range);
  const agg = useActivityToWin(range, filters);
  // Compare-to-Lost honors the salesperson selector too, so a per-rep view
  // compares that rep's wins against that rep's losses (not the whole team).
  // The UNASSIGNED sentinel can't be expressed as an ownerId filter, so it
  // falls back to the window-wide lost cohort.
  const lostFilters = React.useMemo<AwFilters>(
    () => (ownerKey === OWNER_ALL || ownerKey === UNASSIGNED ? filters : { ...filters, ownerId: ownerKey }),
    [filters, ownerKey],
  );
  const lost = useActivityToLost(range, lostFilters);

  // Source dropdown options (all sources in the window).
  const sourceOptions = React.useMemo(() => {
    const set = new Set(windowOnly.rows.map((r) => r.source));
    return [{ value: SOURCE_ALL, label: "All sources" }, ...[...set].sort().map((s) => ({ value: s, label: s }))];
  }, [windowOnly.rows]);

  React.useEffect(() => {
    if (source !== SOURCE_ALL && !windowOnly.rows.some((r) => r.source === source)) setSource(SOURCE_ALL);
  }, [windowOnly.rows, source]);

  const bandOptions = [{ value: BAND_ANY, label: "Any value" }, ...bands.map((b) => ({ value: b.key, label: b.label }))];
  React.useEffect(() => {
    if (bandKey !== BAND_ANY && !bands.some((b) => b.key === bandKey)) setBandKey(BAND_ANY);
  }, [bands, bandKey]);

  const repName = React.useCallback(
    (ownerId: string | null): string => {
      if (!ownerId) return "Unassigned";
      if (ownerId === userId) return "You";
      return memberNames.get(ownerId) ?? "Unassigned";
    },
    [memberNames, userId],
  );

  // Salesperson dropdown: owners present in the (source/band-filtered) window.
  const ownerOptions = React.useMemo(() => {
    const keys = new Set(agg.rows.map((r) => r.ownerId ?? UNASSIGNED));
    const opts = [...keys]
      .map((k) => ({ value: k, label: k === UNASSIGNED ? "Unassigned" : repName(k) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: OWNER_ALL, label: "All Salespeople" }, ...opts];
  }, [agg.rows, repName]);
  // A single-owner window (e.g. a rep) doesn't need the salesperson filter.
  const showOwnerFilter = ownerOptions.length > 2;

  React.useEffect(() => {
    if (ownerKey !== OWNER_ALL && !ownerOptions.some((o) => o.value === ownerKey)) setOwnerKey(OWNER_ALL);
  }, [ownerOptions, ownerKey]);

  // Every section works off the owner-scoped rows.
  const scopedRows = React.useMemo(
    () => (ownerKey === OWNER_ALL ? agg.rows : agg.rows.filter((r) => (r.ownerId ?? UNASSIGNED) === ownerKey)),
    [agg.rows, ownerKey],
  );

  const kpis = React.useMemo(() => activitiesReportKpis(scopedRows), [scopedRows]);
  const ranking = React.useMemo(() => salespersonRanking(scopedRows), [scopedRows]);
  const byType = React.useMemo(() => avgActivitiesByType(scopedRows), [scopedRows]);
  const insights = React.useMemo(
    () => activitiesReportInsights(scopedRows, ranking, isManagerish ? repName : undefined),
    [scopedRows, ranking, isManagerish, repName],
  );
  const sortedRows = React.useMemo(() => sortReportRows(scopedRows, sort.column, sort.dir), [scopedRows, sort]);

  const trend = React.useMemo(() => activityToWinTrend(scopedRows), [scopedRows]);
  const showTrend = trend.length >= 2;

  const toggleSort = (col: ReportSortColumn) =>
    setSort((s) =>
      s.column === col
        ? { column: col, dir: s.dir === "asc" ? "desc" : "asc" }
        : { column: col, dir: col === "company" ? "asc" : "desc" },
    );

  const handleExport = React.useCallback(() => {
    const csv = activityToWinRowsToCsv(sortedRows, { includeRep: isManagerish, repName });
    downloadCsv(csv, `activities-report-${range.toIso.slice(0, 10)}.csv`);
  }, [sortedRows, isManagerish, repName, range.toIso]);

  const rankMedal = (i: number) =>
    i === 0 ? "bg-accent-orange-20 text-accent-orange"
      : i === 1 ? "bg-surface-sunken text-text-muted"
      : i === 2 ? "bg-accent-teal-20 text-accent-teal"
      : "bg-surface-sunken text-text-subtle";

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        {/* Gradient header (US-01) */}
        <div className="relative overflow-hidden rounded-radius-md bg-gradient-to-br from-brand-gradient-from via-brand-gradient-via to-brand-gradient-to p-6 text-white sm:p-8 dark:before:pointer-events-none dark:before:absolute dark:before:inset-0 dark:before:rounded-[inherit] dark:before:bg-black/30 dark:before:content-['']">
          <div className="relative flex flex-col gap-1">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="inline-flex w-fit items-center gap-1 text-caption text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
            </button>
            <h1 className="text-heading-lg text-white">Activities Report</h1>
            <p className="text-body-sm text-white/80">Closed Won Deals - Activity Analysis</p>
          </div>
        </div>

        {/* Primary filters: salesperson + time pills (US-02, US-03) */}
        <div className="flex flex-wrap items-center gap-3">
          {showOwnerFilter && (
            <div className="w-56">
              <Select value={ownerKey} onValueChange={setOwnerKey} options={ownerOptions} />
            </div>
          )}
          <div className="ml-auto flex flex-wrap gap-1.5">
            {REPORT_RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setWindowKey(r.key)}
                className={cn(
                  "rounded-radius-full px-3 py-1.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                  windowKey === r.key
                    ? "bg-brand-primary text-white"
                    : "bg-surface-sunken text-text-muted hover:text-text-default",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {scopedRows.length === 0 ? (
          <Card padding="lg" shadow="sm">
            <p className="text-body-sm text-text-muted">No won deals in this window. Try a longer window or clearing filters.</p>
          </Card>
        ) : (
          <>
            {/* KPI cards (US-04) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
              <ReportKpi
                icon={Trophy} accent="blue" label="Total Deals Closed"
                value={String(kpis.dealsClosed)} sub={formatBandUsd(kpis.totalValueCents)}
              />
              <ReportKpi
                icon={Activity} accent="violet" label="Avg Activities / Deal"
                value={fmt(kpis.avgActivities)}
                sub={kpis.avgBusinessDays != null ? `${fmt(kpis.avgBusinessDays)} days avg to close` : undefined}
              />
              <ReportKpi
                icon={Zap} accent="teal" label="Most Efficient"
                value={kpis.mostEfficient?.company ?? "-"}
                sub={kpis.mostEfficient ? `${kpis.mostEfficient.count} activities` : undefined}
              />
              <ReportKpi
                icon={DollarSign} accent="orange" label="Highest Value"
                value={kpis.highestValue?.company ?? "-"}
                sub={kpis.highestValue ? formatBandUsd(kpis.highestValue.valueCents) : undefined}
              />
            </div>

            {/* Salesperson performance (US-05) */}
            <Card padding="lg" shadow="sm" role="region" aria-label="Salesperson performance">
              <h2 className="mb-4 text-heading-sm text-text-default">Salesperson performance</h2>
              <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
                {ranking.map((rep, i) => (
                  <div key={rep.ownerId ?? UNASSIGNED} className="flex flex-wrap items-center gap-3 rounded-radius-md border border-border-subtle p-3">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold", rankMedal(i))}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span data-testid="rep-name" className="block truncate text-body-strong text-text-default">{repName(rep.ownerId)}</span>
                      <span className="text-caption text-text-muted">
                        {rep.dealsClosed} {rep.dealsClosed === 1 ? "deal" : "deals"} · <span className="text-accent-teal">{formatBandUsd(rep.totalRevenueCents)}</span>
                      </span>
                    </div>
                    <div className="flex gap-4 text-caption text-text-muted">
                      <span>Avg activities <span className="block tabular-nums text-text-default">{fmt(rep.avgActivities)}</span></span>
                      <span>Avg time <span className="block tabular-nums text-text-default">{rep.avgBusinessDays != null ? `${fmt(rep.avgBusinessDays)}d` : "-"}</span></span>
                      <span>Avg deal <span className="block tabular-nums text-text-default">{formatBandUsd(rep.avgDealCents)}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Average activities by type (US-06) */}
            <Card padding="lg" shadow="sm" role="region" aria-label="Average activities by type">
              <h2 className="mb-4 text-heading-sm text-text-default">Average activities by type</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {TYPE_META.map((t) => {
                  const a = ACCENT[t.accent];
                  return (
                    <div key={t.key} className="flex items-center gap-3 rounded-radius-md border border-border-subtle p-3">
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-md", a.bg, a.fg)} aria-hidden>
                        <t.icon className="h-4 w-4" />
                      </span>
                      <div className="flex flex-col">
                        <span className="text-heading-sm tabular-nums text-text-default">{fmt(byType[t.key])}</span>
                        <span className="text-caption text-text-muted">{t.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Deal details table (US-07, US-08) */}
            <div className="overflow-x-auto rounded-radius-md border border-border-subtle">
              <table className="w-full min-w-[720px] border-collapse text-body-sm">
                <thead>
                  <tr className="text-left text-caption uppercase tracking-wide text-text-muted">
                    {TABLE_COLUMNS.map((c) => {
                      const active = sort.column === c.key;
                      const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
                      return (
                        <th
                          key={c.key}
                          aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                          className={cn("px-3 py-2.5 font-medium", c.numeric && "text-right")}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(c.key)}
                            className={cn("inline-flex items-center gap-1 hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary", c.numeric && "flex-row-reverse")}
                          >
                            {c.label}
                            {active && <Arrow className="h-3 w-3" aria-hidden />}
                          </button>
                        </th>
                      );
                    })}
                    {isManagerish && <th className="px-3 py-2.5 font-medium">Rep</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr
                      key={r.dealId}
                      onClick={() => navigate(`/pipeline/${r.dealId}`)}
                      className={cn("cursor-pointer border-t border-border-subtle transition-colors hover:bg-surface-sunken", r.isOutlier && "bg-status-warning-bg")}
                    >
                      <td className="px-3 py-2.5 text-text-default">
                        {r.companyName}
                        {r.isOutlier && <Badge kind="status-due-soon" size="sm" className="ml-2 align-middle">outlier</Badge>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-default">{formatBandUsd(r.valueCents)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{r.counts.call}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{r.counts.email}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{r.counts.dropin}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{r.counts.appointment}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-text-default">{r.counts.total}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-default">{fmt(r.businessDays)}</td>
                      {isManagerish && <td className="px-3 py-2.5 text-text-muted">{repName(r.ownerId)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Key insights (US-09) */}
            <Card padding="lg" shadow="sm" role="region" aria-label="Key insights">
              <h2 className="mb-3 text-heading-sm text-text-default">Key insights</h2>
              {insights.length > 0 ? (
                <ul className="flex flex-col gap-2 border-l-4 border-accent-blue bg-accent-blue-20/40 py-2 pl-4">
                  {insights.map((text) => (
                    <li key={text} className="text-body-sm text-text-default">{text}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-sm text-text-muted">No insights available for the selected criteria.</p>
              )}
            </Card>
          </>
        )}

        {/* Secondary controls: source / value-band / Compare-to-Lost / CSV */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
          <div className="w-48">
            <Select value={source} onValueChange={setSource} options={sourceOptions} />
          </div>
          <div className="w-40">
            <Select value={bandKey} onValueChange={setBandKey} options={bandOptions} />
          </div>
          <Checkbox label="Compare to lost" checked={compareLost} onCheckedChange={setCompareLost} />
          <Button variant="secondary" size="sm" className="ml-auto" onClick={handleExport} disabled={sortedRows.length === 0}>
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </Button>
        </div>

        {compareLost && (
          <Card padding="lg" shadow="sm">
            <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
              <span className="text-caption uppercase tracking-wide text-text-muted">Compared to lost</span>
              <div>
                <p className="text-heading-sm tabular-nums leading-none text-text-muted">{fmt(lost.medianTotal)}</p>
                <span className="text-caption text-text-muted">median touches before loss</span>
              </div>
              <div>
                <p className="text-heading-sm tabular-nums leading-none text-text-muted">{fmt(lost.medianBusinessDays)}</p>
                <span className="text-caption text-text-muted">median business days to loss</span>
              </div>
              <div className="flex flex-col justify-center">
                <span className="text-body-sm text-text-muted">
                  {lost.sampleSize} lost {lost.sampleSize === 1 ? "deal" : "deals"}
                </span>
                {lost.insufficientData && (
                  <span className="text-caption text-text-subtle">Fewer than 3 lost deals; indicative only.</span>
                )}
              </div>
            </div>
          </Card>
        )}

        {showTrend && (
          <Card padding="lg" shadow="sm">
            <div className="flex flex-col gap-4">
              <span className="text-body-sm font-medium text-text-default">Trend by close month</span>
              <div className="flex flex-wrap gap-x-10 gap-y-6">
                <TrendMiniChart title="Median touches" buckets={trend} valueOf={(b) => b.medianTotal} />
                <TrendMiniChart title="Median business days" buckets={trend} valueOf={(b) => b.medianBusinessDays} />
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default ActivityToWinReport;
