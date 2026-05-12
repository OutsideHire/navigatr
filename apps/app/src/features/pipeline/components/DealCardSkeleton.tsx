/**
 * Pipeline DealCardSkeleton — loading placeholder sized to match a real
 * deal card so the list doesn't jump on first paint.
 *
 * Renders pulse-animated surface-sunken blocks at the same rhythm as
 * DealCard (top row company/value, middle row icons, probability bar,
 * bottom row dates). The 4 px left band uses border-subtle so the
 * skeleton still reads as a Card with the band slot reserved.
 */

import { Card } from "@/components/navigatr";

export function DealCardSkeleton() {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex">
        {/* Band slot — neutral while loading. */}
        <div className="w-1 shrink-0 self-stretch bg-border-subtle" aria-hidden />
        <div className="min-w-0 flex-1 animate-pulse p-4">
          <div className="flex flex-col gap-3">
            {/* Top row: company/contact left, value/badge right */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="h-4 w-2/3 rounded-radius-sm bg-surface-sunken" />
                <div className="h-3 w-1/3 rounded-radius-sm bg-surface-sunken" />
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="h-5 w-16 rounded-radius-sm bg-surface-sunken" />
                <div className="h-4 w-20 rounded-radius-full bg-surface-sunken" />
              </div>
            </div>

            {/* Middle row: phone + email + headcount icons */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-8 w-32 rounded-radius-sm bg-surface-sunken" />
              <div className="h-4 w-40 rounded-radius-sm bg-surface-sunken" />
              <div className="h-4 w-20 rounded-radius-sm bg-surface-sunken" />
            </div>

            {/* Probability label + bar */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <div className="h-3 w-20 rounded-radius-sm bg-surface-sunken" />
                <div className="h-3 w-8 rounded-radius-sm bg-surface-sunken" />
              </div>
              <div className="h-px w-full rounded-radius-full bg-surface-sunken" />
            </div>

            {/* Bottom row: dates */}
            <div className="flex items-center justify-between">
              <div className="h-3 w-28 rounded-radius-sm bg-surface-sunken" />
              <div className="h-3 w-20 rounded-radius-sm bg-surface-sunken" />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default DealCardSkeleton;
