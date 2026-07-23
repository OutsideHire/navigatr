/**
 * Activities by Sales Rep and Company: standalone manager report.
 * Counts logged activity by rep (book of business), expandable to per-company
 * breakdowns, with a metric sort, date filter, Grand Total, and CSV export.
 * Gated to viewTeamPage (managers and above).
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, BarChart3, Phone, Mail, Users, CalendarDays,
  ChevronDown, ChevronRight, Check, Clock4, Download, type LucideIcon,
} from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useProfile } from "@/features/auth/useProfile";
import { profileCan } from "@/features/auth/capabilities";
import {
  RANGE_OPTIONS, rangeLabel, resolveRange, type RangeKey,
} from "../lib/dateRange";
import { sortReps, type RcaCountKey, type RepActivity } from "../lib/repCompanyActivity";
import { repCompanyCsv } from "../lib/repCompanyCsv";
import { useRepCompanyActivity } from "../hooks/useRepCompanyActivity";

const TIP_KEY = "rca:tipDismissed";

interface TypeMeta { key: RcaCountKey; label: string; icon: LucideIcon; text: string; bg: string; }
const TYPE_META: TypeMeta[] = [
  { key: "total", label: "Total", icon: BarChart3, text: "text-accent-violet", bg: "bg-accent-violet-20" },
  { key: "call", label: "Calls", icon: Phone, text: "text-accent-blue", bg: "bg-accent-blue-20" },
  { key: "email", label: "Emails", icon: Mail, text: "text-accent-teal", bg: "bg-accent-teal-20" },
  { key: "drop_in", label: "Visits", icon: Users, text: "text-accent-orange", bg: "bg-accent-orange-20" },
  { key: "appointment", label: "Appts", icon: CalendarDays, text: "text-accent-pink", bg: "bg-accent-pink-20" },
];

const RANK_BADGE = [
  "bg-accent-orange-20 text-accent-orange",
  "bg-surface-sunken text-text-muted",
  "bg-status-danger-bg text-status-danger",
  "bg-accent-violet-20 text-accent-violet",
];

function RepRow({
  rep, rank, nameOf, expanded, onToggle,
}: {
  rep: RepActivity; rank: number; nameOf: (id: string | null) => string;
  expanded: boolean; onToggle: () => void;
}) {
  return (
    <Card padding="none" shadow="sm">
      <button
        type="button"
        data-testid={`rep-row-${rep.ownerId ?? "unassigned"}`}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      >
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold", RANK_BADGE[Math.min(rank - 1, 3)])}>
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-body-strong text-text-default">{nameOf(rep.ownerId)}</div>
          <div className="text-caption text-text-muted">
            {rep.companyCount} {rep.companyCount === 1 ? "company" : "companies"} · {rep.counts.total} total activities
          </div>
        </div>
        <div className="hidden gap-4 sm:flex">
          {TYPE_META.slice(1).map((t) => (
            <span key={t.key} className={cn("inline-flex items-center gap-1 text-caption tabular-nums", t.text)}>
              <t.icon className="h-3.5 w-3.5" aria-hidden /> {rep.counts[t.key]}
            </span>
          ))}
        </div>
        {expanded ? <ChevronDown className="h-5 w-5 shrink-0 text-text-subtle" /> : <ChevronRight className="h-5 w-5 shrink-0 text-text-subtle" />}
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-border px-4 py-3">
          <table className="w-full min-w-[520px] text-caption">
            <thead>
              <tr className="text-text-muted">
                <th className="py-1 text-left font-normal">Company</th>
                <th className="py-1 text-right font-normal">Calls</th>
                <th className="py-1 text-right font-normal">Emails</th>
                <th className="py-1 text-right font-normal">Visits</th>
                <th className="py-1 text-right font-normal">Appointments</th>
                <th className="py-1 text-right font-medium text-text-default">Total</th>
              </tr>
            </thead>
            <tbody className="text-text-default tabular-nums">
              {rep.companies.map((c) => (
                <tr key={c.companyName}>
                  <td className="py-1 text-left text-text-muted">{c.companyName}</td>
                  <td className="py-1 text-right">{c.counts.call}</td>
                  <td className="py-1 text-right">{c.counts.email}</td>
                  <td className="py-1 text-right">{c.counts.drop_in}</td>
                  <td className="py-1 text-right">{c.counts.appointment}</td>
                  <td className="py-1 text-right font-medium">{c.counts.total}</td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-1.5 text-left font-medium">Subtotal</td>
                <td className="py-1.5 text-right">{rep.counts.call}</td>
                <td className="py-1.5 text-right">{rep.counts.email}</td>
                <td className="py-1.5 text-right">{rep.counts.drop_in}</td>
                <td className="py-1.5 text-right">{rep.counts.appointment}</td>
                <td className="py-1.5 text-right font-medium">{rep.counts.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ActivitiesByRepCompanyReport() {
  const navigate = useNavigate();
  const profile = useProfile().data;
  const allowed = profileCan(profile, "viewTeamPage");

  const [rangeKey, setRangeKey] = React.useState<RangeKey>("90d");
  const range = React.useMemo(() => resolveRange(rangeKey, new Date()), [rangeKey]);
  const [metric, setMetric] = React.useState<RcaCountKey>("total");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [tipDismissed, setTipDismissed] = React.useState<boolean>(
    () => localStorage.getItem(TIP_KEY) === "1",
  );

  const { reps, grandTotal, nameOf, isLoading } = useRepCompanyActivity(range);
  const sorted = React.useMemo(() => sortReps(reps, metric, nameOf), [reps, metric, nameOf]);

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 text-center">
        <h1 className="text-heading-md text-text-default">Report not available</h1>
        <p className="mt-2 text-body-md text-text-muted">
          This report is available to sales managers and above.
        </p>
        <Button variant="tertiary" size="md" className="mt-4" leadingIcon={ArrowLeft} onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const dismissTip = () => { localStorage.setItem(TIP_KEY, "1"); setTipDismissed(true); };

  const exportCsv = () => {
    const csv = repCompanyCsv(sorted, nameOf, grandTotal);
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activities-by-rep-company-${rangeKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <button type="button" onClick={() => navigate("/dashboard")} className="mb-3 inline-flex items-center gap-1 text-caption text-text-muted hover:text-text-default">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </button>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-heading-lg text-text-default">Activities by sales rep and company</h1>
          <p className="text-body-md text-text-muted">Total activity breakdown for each representative · {rangeLabel(rangeKey)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="tertiary" size="sm" leadingIcon={Download} onClick={exportCsv}>Export CSV</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="tertiary" size="sm" leadingIcon={Clock4} trailingIcon={ChevronDown}>{rangeLabel(rangeKey)}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {RANGE_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.key} onSelect={() => setRangeKey(opt.key)}>
                  <Check className={cn("mr-2 h-4 w-4", opt.key === rangeKey ? "opacity-100" : "opacity-0")} />
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TYPE_META.map((t) => {
          const active = metric === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => setMetric(t.key)}
              className={cn(
                "rounded-radius-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                active ? cn("border-brand-primary", t.bg) : "border-border bg-surface-default hover:bg-surface-sunken",
              )}
            >
              <span className={cn("inline-flex items-center gap-1 text-caption", t.text)}>
                <t.icon className="h-4 w-4" aria-hidden /> {t.label}
              </span>
              <div className="mt-1 text-heading-sm tabular-nums text-text-default">{grandTotal[t.key]}</div>
            </button>
          );
        })}
      </div>

      {!tipDismissed && (
        <div className="mt-4 flex items-start gap-2 rounded-radius-md bg-accent-blue-20 px-3 py-2 text-caption text-accent-blue">
          <span className="flex-1"><span className="font-semibold">Tip:</span> click an activity card above to sort by that metric. Click a rep to expand their company breakdown.</span>
          <button type="button" aria-label="dismiss tip" onClick={dismissTip} className="shrink-0 font-medium underline-offset-2 hover:underline">Dismiss</button>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {isLoading && <p className="text-body-sm text-text-muted">Loading...</p>}
        {!isLoading && sorted.length === 0 && (
          <Card padding="lg" shadow="sm"><p className="text-body-sm text-text-muted">No activity logged in this period.</p></Card>
        )}
        {sorted.map((rep, i) => (
          <div key={rep.ownerId ?? "unassigned"} data-testid="rep-row">
            <RepRow
              rep={rep}
              rank={i + 1}
              nameOf={nameOf}
              expanded={expanded.has(rep.ownerId ?? "unassigned")}
              onToggle={() => toggle(rep.ownerId ?? "unassigned")}
            />
          </div>
        ))}
      </div>

      {!isLoading && sorted.length > 0 && (
        <div className="mt-5 rounded-radius-md border border-accent-blue bg-accent-blue-20 p-4">
          <div className="mb-3 text-body-strong text-accent-blue">Grand total · all representatives</div>
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
            {TYPE_META.map((t) => (
              <div key={t.key}>
                <div className={cn("text-heading-md tabular-nums", t.text)}>{grandTotal[t.key]}</div>
                <div className="text-caption text-text-muted">{t.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ActivitiesByRepCompanyReport;
