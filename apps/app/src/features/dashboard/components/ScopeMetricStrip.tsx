/** ScopeMetricStrip: the active scope's headline KPI cards (label, value, sub). */
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import type { KpiCard } from "../lib/activityPerformance";

export function ScopeMetricStrip({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
      {cards.map((c) => (
        <Card
          key={c.label}
          padding="md"
          shadow="sm"
          className={cn(c.flag && "border-status-warning/40 bg-status-warning-bg")}
        >
          <div className="flex flex-col gap-1">
            <span className="text-eyebrow uppercase tracking-wide text-text-subtle">{c.label}</span>
            <span className={cn("text-heading-sm tabular-nums text-text-default", c.flag && "text-status-warning")}>
              {c.value}
            </span>
            <span className="text-caption text-text-subtle">{c.sub}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default ScopeMetricStrip;
