/**
 * CoverageWidget — SP2a rep dashboard card surfacing Activity Logging Coverage.
 * Reads the rep's own snapshots; derives the band from the shared band() math;
 * renders an instructional empty state (no data / insufficient), a thin-data
 * state (% + "Estimated · low confidence"), or a solid state (% only). Trend
 * sparkline reuses the DIY flex-bar idiom. Data-quality framing, never compliance.
 */
import * as Popover from "@radix-ui/react-popover";
import { Phone } from "lucide-react";
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { useCoverageSnapshots } from "../hooks/useCoverageSnapshots";
import { bandPresentation, confidenceLabel } from "../lib/bandPresentation";
import { band } from "../../../../../../supabase/functions/_shared/coverage/score";
import { DEFAULT_COVERAGE_CONFIG } from "../../../../../../supabase/functions/_shared/coverage/config";

function Methodology() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="text-body-sm text-brand-primary hover:underline">
          How is this calculated?
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-radius-md border border-border-default bg-surface-default p-4 text-body-sm text-text-muted shadow-card-hover"
        >
          <p className="mb-2 font-semibold text-text-default">How logging coverage works</p>
          <p className="mb-2">
            We estimate how much of your calling is captured. A tap-to-call counts as
            <strong> logged</strong> when you log a Call activity for that deal within 4 hours.
          </p>
          <p>
            It's a data-quality guide, not a score — low coverage just means some calls weren't
            logged yet. More channels (calendar, email) will sharpen the estimate later.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CoverageWidget() {
  const { latest, series } = useCoverageSnapshots();
  const hasData = latest != null && latest.confidenceLevel !== "insufficient";

  if (!hasData) {
    return (
      <Card padding="lg" shadow="sm">
        <div className="flex items-center justify-between">
          <h2 className="text-heading-sm text-text-default">Logging coverage</h2>
          <span className="rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption text-text-subtle">
            No data yet
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-radius-md bg-surface-sunken text-text-subtle">
            <Phone className="h-4 w-4" aria-hidden />
          </span>
          <p className="text-body-md font-semibold text-text-default">No coverage data yet</p>
          <p className="text-body-sm text-text-muted">
            Make calls with tap-to-call and log the outcome — once you have a few, we'll show how
            much of your calling is captured.
          </p>
          <div className="mt-1"><Methodology /></div>
        </div>
      </Card>
    );
  }

  const pct = Math.round(latest.compositeCoverage * 100);
  const b = band(latest.compositeCoverage, DEFAULT_COVERAGE_CONFIG.bandThresholds);
  const pres = bandPresentation(b);
  const qualifier = confidenceLabel(latest.confidenceLevel);
  // Display-only estimate reconstructed from the stored coverage ratio × events;
  // may differ by ±1 from the true logged count near rounding boundaries.
  const logged = Math.round((latest.callCoverage ?? 0) * latest.callEventCount);
  const maxComposite = Math.max(...series.map((s) => s.compositeCoverage), 0.01);

  return (
    <Card padding="lg" shadow="sm">
      <div className="flex items-center justify-between">
        <h2 className="text-heading-sm text-text-default">Logging coverage</h2>
        <span className={cn("rounded-radius-full px-2 py-0.5 text-caption font-semibold", pres.pillClass)}>
          {pres.label}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-kpi-lg font-bold tabular-nums", pres.tokenClass)}>{pct}%</span>
        {qualifier && <span className="text-body-sm text-text-muted">{qualifier}</span>}
      </div>

      <p className="mt-1 text-body-sm text-text-muted">
        Phone · {latest.callEventCount} calls · {logged} logged
      </p>

      {series.length >= 2 && (
        <div data-testid="coverage-sparkline" className="mt-3 flex h-9 items-end gap-1" aria-hidden>
          {series.map((s) => (
            <span
              key={s.snapshotDate}
              className={cn("flex-1 rounded-t-radius-sm opacity-90", pres.barClass)}
              style={{ height: `${Math.max((s.compositeCoverage / maxComposite) * 100, 4)}%` }}
            />
          ))}
        </div>
      )}

      <div className="mt-3"><Methodology /></div>
    </Card>
  );
}
