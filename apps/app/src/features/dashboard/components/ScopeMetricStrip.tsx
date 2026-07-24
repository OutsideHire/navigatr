/** ScopeMetricStrip: the active scope's headline metrics as a small card grid. */
import { Card } from "@/components/navigatr";
import type { MetricCell } from "../lib/unifiedActivityReport";

export function ScopeMetricStrip({ metrics }: { metrics: MetricCell[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {metrics.map((m) => (
        <Card key={m.label} padding="md" shadow="sm">
          <div className="flex flex-col gap-0.5">
            <span className="text-caption uppercase tracking-wide text-text-muted">{m.label}</span>
            <span className="text-heading-sm tabular-nums text-text-default">{m.value}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default ScopeMetricStrip;
