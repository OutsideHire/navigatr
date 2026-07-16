/**
 * Activity-to-Win report — the per-deal detail behind the dashboard headline
 * (PRD §3.3.A.11, FR-DASH-AW-04/05). Lists the won deals that make up the
 * medians, with per-type touch mix, days-to-close, and outlier flags, sorted
 * by close date. Filterable by window / source / value band. Reps see only
 * their own deals (RLS + the rep column is hidden); managers see their team.
 *
 * CSV export + Compare-to-Lost land in a later slice.
 */

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Select, Badge } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useOrgMemberNames } from "../hooks/useOrgMemberNames";
import { useActivityToWin } from "../hooks/useActivityToWin";
import {
  VALUE_BANDS,
  type AwFilters,
  type ActivityToWinRow,
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

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="w-40">
            <Select value={windowKey} onValueChange={(v) => setWindowKey(v as RangeKey)} options={RANGE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
          </div>
          <div className="w-48">
            <Select value={source} onValueChange={setSource} options={sourceOptions} />
          </div>
          <div className="w-40">
            <Select value={bandKey} onValueChange={setBandKey} options={bandOptions} />
          </div>
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
