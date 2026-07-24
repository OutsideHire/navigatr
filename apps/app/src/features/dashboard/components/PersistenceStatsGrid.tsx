/**
 * PersistenceStatsGrid: the "this period" stats for the Persistence Index
 * detail page. Index movement + activity always shown; benchmark cells only
 * when peer benchmarks are available (manager/admin scope). Cells with no
 * value are omitted rather than fabricated.
 */
import { Card } from "@/components/navigatr";
import type { PersistenceStats } from "../lib/persistenceIndex";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption text-text-muted">{label}</div>
      <div className="text-body-md tabular-nums text-text-default">{value}</div>
    </div>
  );
}

export function PersistenceStatsGrid({
  stats, peerAvg, topLabel, topValue, showBenchmarks,
}: {
  stats: PersistenceStats;
  peerAvg: number | null;
  topLabel: string;
  topValue: number | null;
  showBenchmarks: boolean;
}) {
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-3">
        <span className="text-body-sm font-medium text-text-default">This period</span>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {stats.high != null && stats.low != null && <Stat label="High / Low" value={`${stats.high} / ${stats.low}`} />}
          {stats.periodAvg != null && <Stat label="Period average" value={String(stats.periodAvg)} />}
          <Stat label="Daily activity avg" value={String(stats.dailyActivityAvg)} />
          {showBenchmarks && stats.daysAboveAvg != null && <Stat label="Days above average" value={`${stats.daysAboveAvg} / ${stats.scoredDays}`} />}
          {showBenchmarks && peerAvg != null && <Stat label="Peer average" value={String(peerAvg)} />}
          {showBenchmarks && topValue != null && <Stat label={topLabel} value={String(topValue)} />}
        </div>
        {showBenchmarks && stats.periodAvg != null && (
          <p className="text-caption text-text-subtle">Benchmarks are computed across the reps you can see.</p>
        )}
      </div>
    </Card>
  );
}

export default PersistenceStatsGrid;
