/**
 * Activity-to-Win report — the per-deal detail behind the dashboard headline
 * (PRD §3.3.A.11, FR-DASH-AW-04/05). Lists the won deals that make up the
 * medians, with per-type touch mix, days-to-close, and outlier flags, sorted
 * by close date. Filterable by window / source / value band, with a
 * month-by-month trend and CSV export. Reps see only their own deals (RLS +
 * the rep column is hidden); managers see their team.
 *
 * Compare-to-Lost lands in a later slice (needs lost-deal snapshot data).
 */

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Select, Badge, Button } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useOrgMemberNames } from "../hooks/useOrgMemberNames";
import { useActivityToWin } from "../hooks/useActivityToWin";
import {
  VALUE_BANDS,
  activityToWinTrend,
  activityToWinRowsToCsv,
  type AwFilters,
  type ActivityToWinRow,
  type AwTrendBucket,
} from "../lib/activityToWin";
import { RANGE_OPTIONS, rangeLabel, resolveRange, type RangeKey } from "../lib/dateRange";
import { formatShortDate } from "@/features/pipeline/mockData";

function fmt(n: number | null): string {
  if (n == null) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Compact per-type mix, e.g. "2c · 1e · 2d". Omits zero types; "-" if none. */
function mixLabel(counts: ActivityToWinRow["counts"]): string {
  const parts: string[] = [];
  if (counts.call > 0) parts.push(`${counts.call}c`);
  if (counts.email > 0) parts.push(`${counts.email}e`);
  if (counts.dropin > 0) parts.push(`${counts.dropin}d`);
  if (counts.appointment > 0) parts.push(`${counts.appointment}a`);
  return parts.length ? parts.join(" · ") : "-";
}

/**
 * A single month-bucketed bar chart (CSS bars, no chart lib). Bars scale to
 * the series max; a null month renders a baseline tick rather than a 0-bar so
 * "no measured deals" reads differently from "closed in zero touches".
 */
function TrendMiniChart({
  title,
  buckets,
  valueOf,
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
                  <div
                    className="w-full rounded-t-radius-sm bg-brand-primary"
                    style={{ height: `${heightPct}%` }}
                  />
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

/** Build a CSV blob for the given rows and trigger a client-side download. */
function downloadCsv(csv: string, filename: string) {
  // Prepend a UTF-8 BOM (U+FEFF) so Excel opens accented names correctly.
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

const SOURCE_ALL = "__all__";
const BAND_ANY = "__any__";

export function ActivityToWinReport() {
  const navigate = useNavigate();
  const role = useProfile().data?.role;
  const isManagerish = role === "manager" || role === "admin";
  const memberNames = useOrgMemberNames(isManagerish);

  const [windowKey, setWindowKey] = React.useState<RangeKey>("90d");
  const [source, setSource] = React.useState<string>(SOURCE_ALL);
  const [bandKey, setBandKey] = React.useState<string>(BAND_ANY);

  // resolveRange captures "now" per window selection (not per render).
  const range = React.useMemo(() => resolveRange(windowKey, new Date()), [windowKey]);

  const filters = React.useMemo<AwFilters>(() => {
    const band = VALUE_BANDS.find((b) => b.key === bandKey);
    return {
      source: source === SOURCE_ALL ? undefined : source,
      valueBand: band ? { minCents: band.minCents, maxCents: band.maxCents } : undefined,
    };
  }, [source, bandKey]);

  // Window-only pass drives the source dropdown options (all sources in the
  // window, independent of the active source filter). Filtered pass drives
  // the summary + table.
  const windowOnly = useActivityToWin(range);
  const agg = useActivityToWin(range, filters);

  const sourceOptions = React.useMemo(() => {
    const set = new Set(windowOnly.rows.map((r) => r.source));
    return [
      { value: SOURCE_ALL, label: "All sources" },
      ...[...set].sort().map((s) => ({ value: s, label: s })),
    ];
  }, [windowOnly.rows]);

  // A selected source can drop out of the option set when the window changes
  // (e.g. "Referral" picked, then a shorter window with no referral wins).
  // Fall back to "All sources" so the dropdown never shows a stale/blank value.
  React.useEffect(() => {
    if (source !== SOURCE_ALL && !windowOnly.rows.some((r) => r.source === source)) {
      setSource(SOURCE_ALL);
    }
  }, [windowOnly.rows, source]);

  const bandOptions = [
    { value: BAND_ANY, label: "Any value" },
    ...VALUE_BANDS.map((b) => ({ value: b.key, label: b.label })),
  ];

  const rows = React.useMemo(
    () => [...agg.rows].sort((a, b) => b.closedWonAt.localeCompare(a.closedWonAt)),
    [agg.rows],
  );

  const medDays = agg.medianBusinessDays;
  const iqr =
    agg.p25BusinessDays != null && agg.p75BusinessDays != null
      ? ` (${fmt(agg.p25BusinessDays)}-${fmt(agg.p75BusinessDays)})`
      : "";

  // Trend needs ≥2 months to read as a trend; otherwise the summary says it all.
  const trend = React.useMemo(() => activityToWinTrend(rows), [rows]);
  const showTrend = trend.length >= 2;

  const repName = React.useCallback(
    (ownerId: string | null) => (ownerId ? memberNames.get(ownerId) ?? "Unassigned" : "Unassigned"),
    [memberNames],
  );

  const handleExport = React.useCallback(() => {
    const csv = activityToWinRowsToCsv(rows, { includeRep: isManagerish, repName });
    downloadCsv(csv, `activity-to-win-${range.toIso.slice(0, 10)}.csv`);
  }, [rows, isManagerish, repName, range.toIso]);

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex w-fit items-center gap-1 text-body-sm text-text-muted hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
          </button>
          <h1 className="text-heading-md text-text-default">Activity-to-Win</h1>
          <p className="text-body-sm text-text-muted">The won deals behind the number · {rangeLabel(windowKey)}</p>
        </div>

        {/* Summary */}
        <Card padding="lg" shadow="sm">
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <p className="text-kpi-md tabular-nums leading-none text-text-default">{fmt(agg.medianTotal)}</p>
              <span className="text-caption text-text-muted">median touches to close</span>
            </div>
            <div>
              <p className="text-kpi-md tabular-nums leading-none text-text-default">
                {fmt(medDays)}<span className="text-body-sm text-text-muted">{iqr}</span>
              </p>
              <span className="text-caption text-text-muted">median business days to close</span>
            </div>
            <div className="flex flex-col justify-center">
              <span className="text-body-sm text-text-default">
                {agg.sampleSize} won {agg.sampleSize === 1 ? "deal" : "deals"}
                {agg.unmeasuredWins > 0 ? ` · ${agg.unmeasuredWins} unmeasured` : ""}
              </span>
              {agg.insufficientData && (
                <span className="text-caption text-status-warning">Fewer than 3 deals; medians are indicative only.</span>
              )}
            </div>
          </div>
        </Card>

        {/* Trend by month */}
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

        {/* Filters + export */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-40">
            <Select value={windowKey} onValueChange={(v) => setWindowKey(v as RangeKey)} options={RANGE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
          </div>
          <div className="w-48">
            <Select value={source} onValueChange={setSource} options={sourceOptions} />
          </div>
          <div className="w-40">
            <Select value={bandKey} onValueChange={setBandKey} options={bandOptions} />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={handleExport}
            disabled={rows.length === 0}
          >
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </Button>
        </div>

        {/* Detail table */}
        {rows.length === 0 ? (
          <Card padding="lg" shadow="sm">
            <p className="text-body-sm text-text-muted">No won deals in this window. Try a longer window or clearing filters.</p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-radius-md border border-border-subtle">
            <table className="w-full min-w-[560px] border-collapse text-body-sm">
              <thead>
                <tr className="text-left text-caption uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2.5 font-medium">Deal</th>
                  {isManagerish && <th className="px-3 py-2.5 font-medium">Rep</th>}
                  <th className="px-3 py-2.5 text-right font-medium">Touches</th>
                  <th className="px-3 py-2.5 font-medium">Mix</th>
                  <th className="px-3 py-2.5 text-right font-medium">Days</th>
                  <th className="px-3 py-2.5 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.dealId}
                    onClick={() => navigate(`/pipeline/${r.dealId}`)}
                    className={cn(
                      "cursor-pointer border-t border-border-subtle transition-colors hover:bg-surface-sunken",
                      r.isOutlier && "bg-status-warning-bg",
                    )}
                  >
                    <td className="px-3 py-2.5 text-text-default">
                      {r.companyName}
                      {r.isOutlier && (
                        <Badge kind="status-due-soon" size="sm" className="ml-2 align-middle">outlier</Badge>
                      )}
                    </td>
                    {isManagerish && (
                      <td className="px-3 py-2.5 text-text-muted">
                        {r.ownerId ? memberNames.get(r.ownerId) ?? "Unassigned" : "Unassigned"}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-default">{r.counts.total}</td>
                    <td className="px-3 py-2.5 text-text-muted">{mixLabel(r.counts)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-default">{fmt(r.businessDays)}</td>
                    <td className="px-3 py-2.5 text-text-muted">{formatShortDate(r.closedWonAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-caption text-text-subtle">
          Sorted by close date. Mix = calls · emails · drop-ins · appointments. Rows more than 2 standard deviations from the median are flagged.
        </p>
      </div>
    </div>
  );
}

export default ActivityToWinReport;
