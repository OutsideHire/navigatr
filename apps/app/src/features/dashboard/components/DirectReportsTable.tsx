/**
 * DirectReportsTable — the Persistence Index "Direct reports" table (SP-1).
 * Renders one keyboard-reachable row per rep (index, 30-day change, activity
 * count, trailing sparkline, status badge), with status filter pills and CSV
 * export. Sorting/status/filtering come from the pure directReports helpers;
 * this component is presentation + local filter state.
 */
import * as React from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import {
  buildDirectReportRows,
  filterDirectReports,
  directReportsCsv,
  DIRECT_REPORT_STATUS_LABEL,
  type DirectReportInput,
  type DirectReportFilter,
  type DirectReportStatus,
} from "../lib/directReports";

const FILTERS: { key: DirectReportFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trending_up", label: "Trending up" },
  { key: "holding", label: "Holding" },
  { key: "needs_attention", label: "Needs attention" },
];

const STATUS_TONE: Record<DirectReportStatus, string> = {
  trending_up: "bg-status-success-bg text-status-success",
  holding: "bg-surface-sunken text-text-muted",
  needs_attention: "bg-status-warning-bg text-status-warning",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

/** Tiny trend sparkline over the trailing composite series. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-caption text-text-subtle">—</span>;
  const W = 72;
  const H = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / span) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-5 w-[72px]" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function downloadCsv(csv: string, filename: string) {
  // BOM so Excel reads UTF-8; anchor-click download.
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

export function DirectReportsTable({
  rows,
  onSelect,
}: {
  rows: DirectReportInput[];
  onSelect: (ownerId: string) => void;
}) {
  const [filter, setFilter] = React.useState<DirectReportFilter>("all");
  const built = React.useMemo(() => buildDirectReportRows(rows), [rows]);
  const visible = React.useMemo(() => filterDirectReports(built, filter), [built, filter]);

  if (built.length === 0) return null;

  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-body-sm font-medium text-text-default">Direct reports</span>
          <button
            type="button"
            onClick={() => downloadCsv(directReportsCsv(visible), "persistence-direct-reports.csv")}
            className="text-caption text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            Export CSV
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-radius-full px-3 py-1 text-caption",
                filter === f.key
                  ? "bg-brand-primary text-brand-primary-foreground"
                  : "bg-surface-sunken text-text-muted hover:text-text-default",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[1.6fr_0.6fr_0.6fr_0.7fr_1fr_1fr] gap-2 border-b border-border-subtle pb-2 text-caption uppercase tracking-wide text-text-subtle">
              <span>Rep</span>
              <span className="text-right">Index</span>
              <span className="text-right">30 day</span>
              <span className="text-right">Activities</span>
              <span>Trailing 60 days</span>
              <span>Status</span>
            </div>
            {visible.map((r) => (
              <button
                key={r.ownerId}
                type="button"
                onClick={() => onSelect(r.ownerId)}
                data-testid="direct-report-row"
                className="grid w-full grid-cols-[1.6fr_0.6fr_0.6fr_0.7fr_1fr_1fr] items-center gap-2 border-b border-border-subtle py-2.5 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-caption font-medium text-text-muted"
                    aria-hidden
                  >
                    {initials(r.name)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-sm text-text-default">{r.name}</span>
                    {r.role && <span className="truncate text-caption text-text-subtle">{r.role}</span>}
                  </span>
                </span>

                <span className="text-right text-body-sm tabular-nums text-text-default">
                  {r.composite == null ? <span className="text-text-subtle">—</span> : r.composite.toFixed(1)}
                </span>

                <span
                  className={cn(
                    "inline-flex items-center justify-end gap-0.5 text-right text-caption tabular-nums",
                    r.delta30 == null
                      ? "text-text-subtle"
                      : r.delta30 > 0
                        ? "text-status-success"
                        : r.delta30 < 0
                          ? "text-status-danger"
                          : "text-text-muted",
                  )}
                >
                  {r.delta30 == null ? (
                    "—"
                  ) : (
                    <>
                      {r.delta30 > 0 ? (
                        <ArrowUpRight className="h-3 w-3" aria-hidden />
                      ) : r.delta30 < 0 ? (
                        <ArrowDownRight className="h-3 w-3" aria-hidden />
                      ) : null}
                      {r.delta30 > 0 ? "+" : ""}
                      {r.delta30.toFixed(1)}
                    </>
                  )}
                </span>

                <span className="text-right text-body-sm tabular-nums text-text-muted">{r.activityCount}</span>

                <span className="text-text-muted">
                  <Sparkline values={r.spark} />
                </span>

                <span>
                  <span className={cn("inline-flex rounded-radius-full px-2 py-0.5 text-caption font-medium", STATUS_TONE[r.status])}>
                    {DIRECT_REPORT_STATUS_LABEL[r.status]}
                  </span>
                </span>
              </button>
            ))}
            {visible.length === 0 && (
              <p className="py-4 text-center text-caption text-text-subtle">No reps in this filter.</p>
            )}
          </div>
        </div>

        <p className="text-caption text-text-subtle">Select a rep to open their individual index.</p>
      </div>
    </Card>
  );
}

export default DirectReportsTable;
