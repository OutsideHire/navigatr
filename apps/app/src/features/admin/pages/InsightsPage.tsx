/**
 * /admin/insights — admin-facing reports surface. v1 ships one widget:
 * "Why are we losing deals?" Lost-reason rollup over a 7/30/90 day window.
 *
 * Why a dedicated page (not a card on /admin/agents): the Team page has
 * its own window selector that controls leaderboard windowing. Two window
 * selectors on the same page would confuse the admin and tangle state.
 * Insights gets its own surface so this widget — and the next 5 we'll add
 * — can live coherently.
 */
import * as React from "react";
import { Button, Card } from "@/components/navigatr";
import {
  useLostReasonRollup,
  LOST_REASON_LABELS,
  type LostReasonRow,
} from "../hooks/useLostReasonRollup";

const WINDOW_OPTIONS: { label: string; value: number }[] = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function LostReasonRollupCard({ windowDays }: { windowDays: number }) {
  const { data, isLoading, error } = useLostReasonRollup(windowDays);

  const totalCount = (data ?? []).reduce((s, r) => s + r.deal_count, 0);
  const totalLost = (data ?? []).reduce((s, r) => s + r.lost_value_cents, 0);
  // For the bar visualization — proportional to the top row's count so the
  // largest bar fills the full track.
  const maxCount = Math.max(1, ...((data ?? []).map((r) => r.deal_count)));

  return (
    <Card padding="lg">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-body-strong text-text-default">Why deals are lost</h2>
        {data && data.length > 0 && (
          <span className="text-caption text-text-muted tabular-nums">
            {totalCount} deals · {formatUsd(totalLost)} lost
          </span>
        )}
      </header>

      {isLoading && (
        <p className="text-body-md text-text-muted">Loading…</p>
      )}

      {error && (
        <p className="text-body-md text-status-danger">
          Couldn't load lost-reason data. {(error as Error).message}
        </p>
      )}

      {data && data.length === 0 && !isLoading && (
        <p className="text-body-md text-text-muted">
          No deals marked lost in this window. {/* Empty state copy stays
            literal — "great news" / "celebrate" framing reads sarcastic
            when the cause is "no deals at all," which is also possible
            for a brand-new ISO. */}
        </p>
      )}

      {data && data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.map((row: LostReasonRow) => {
            const pct = Math.round((row.deal_count / maxCount) * 100);
            return (
              <li key={row.category} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-body-md text-text-default">
                    {LOST_REASON_LABELS[row.category]}
                  </span>
                  <span className="text-caption text-text-muted tabular-nums">
                    {row.deal_count} · {formatUsd(row.lost_value_cents)}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={row.deal_count}
                  aria-valuemin={0}
                  aria-valuemax={maxCount}
                  className="h-2 overflow-hidden rounded-radius-full bg-surface-sunken"
                >
                  <div
                    className="h-full rounded-radius-full bg-brand-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function InsightsPage() {
  const [windowDays, setWindowDays] = React.useState<number>(30);

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="w-full max-w-3xl flex flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-heading-lg text-text-default">Insights</h1>
          <div className="ml-auto flex items-center gap-1 border-l border-border-subtle pl-2">
            {WINDOW_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={windowDays === opt.value ? "secondary" : "tertiary"}
                size="sm"
                onClick={() => setWindowDays(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </header>

        <LostReasonRollupCard windowDays={windowDays} />
      </div>
    </div>
  );
}

export default InsightsPage;
