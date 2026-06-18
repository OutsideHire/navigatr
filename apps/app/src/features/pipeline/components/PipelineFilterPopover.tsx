/**
 * PipelineFilterPopover — the "Filter" trigger + anchored popover panel for the
 * pipeline list. Surfaces the three DealFilters controls (min value, min
 * probability, follow-up) plus a Clear link, and shows a count badge on the
 * trigger when any filter is active.
 *
 * Stateless: filters live in the parent; this component reports every change
 * up through `onChange`. Reuses navigatr Button / Input / Select as-is.
 */

import * as Popover from "@radix-ui/react-popover";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/navigatr/Button";
import { Input } from "@/components/navigatr/Input";
import { Select } from "@/components/navigatr/Select";
import { cn } from "@/lib/utils";
import {
  type DealFilters,
  EMPTY_DEAL_FILTERS,
  activeFilterCount,
} from "../lib/filterDeals";

export interface PipelineFilterPopoverProps {
  filters: DealFilters;
  onChange: (f: DealFilters) => void;
}

// Radix Select forbids an empty-string Item value (it reserves "" for the
// cleared/placeholder state). We use the sentinel "any" for the "Any" option
// and map it to/from null at the boundary, so minProbability stays null when
// "Any" is selected.
const PROBABILITY_ANY = "any";
const PROBABILITY_OPTIONS = [
  { value: PROBABILITY_ANY, label: "Any" },
  { value: "25", label: "25%+" },
  { value: "50", label: "50%+" },
  { value: "75", label: "75%+" },
];

const FOLLOW_UP_OPTIONS: { value: DealFilters["followUp"]; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "has", label: "Has follow-up" },
  { value: "none", label: "None" },
];

export function PipelineFilterPopover({
  filters,
  onChange,
}: PipelineFilterPopoverProps) {
  const count = activeFilterCount(filters);

  return (
    <Popover.Root>
      <div className="relative inline-flex">
        <Popover.Trigger asChild>
          <Button variant="secondary" size="md" leadingIcon={SlidersHorizontal}>
            Filter
          </Button>
        </Popover.Trigger>
        {count > 0 && (
          <span
            data-testid="filter-count"
            className={cn(
              "pointer-events-none absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center",
              "rounded-radius-full bg-brand-primary px-1 text-caption font-medium text-brand-primary-foreground",
            )}
          >
            {count}
          </span>
        )}
      </div>

      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="start"
          className="rounded-radius-md border border-border-default bg-surface-default p-4 shadow-card-hover z-50 w-72 flex flex-col gap-4"
        >
          {/* Min value */}
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">
              Min value
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              prefix="$"
              placeholder="0"
              value={
                filters.minValueCents != null
                  ? String(filters.minValueCents / 100)
                  : ""
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (raw.trim() === "") {
                  onChange({ ...filters, minValueCents: null });
                  return;
                }
                const n = Number(raw);
                onChange({
                  ...filters,
                  minValueCents: Number.isNaN(n)
                    ? null
                    : Math.max(0, Math.round(n)) * 100,
                });
              }}
            />
          </label>

          {/* Min probability */}
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">
              Min probability
            </span>
            <Select
              value={
                filters.minProbability != null
                  ? String(filters.minProbability)
                  : PROBABILITY_ANY
              }
              onValueChange={(v) =>
                onChange({
                  ...filters,
                  minProbability: v === PROBABILITY_ANY ? null : Number(v),
                })
              }
              options={PROBABILITY_OPTIONS}
              placeholder="Any"
            />
          </label>

          {/* Follow-up */}
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">
              Follow-up
            </span>
            <div className="flex gap-2">
              {FOLLOW_UP_OPTIONS.map((opt) => {
                const active = filters.followUp === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      onChange({ ...filters, followUp: opt.value })
                    }
                    className={cn(
                      "flex-1 rounded-radius-sm border px-2 py-1.5 text-caption font-medium transition-colors",
                      active
                        ? "border-brand-primary bg-brand-primary text-brand-primary-foreground"
                        : "border-border-default bg-surface-default text-text-default hover:bg-surface-sunken",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Clear */}
          <div className="flex justify-end">
            <Button
              variant="tertiary"
              size="sm"
              disabled={count === 0}
              onClick={() => onChange(EMPTY_DEAL_FILTERS)}
            >
              Clear
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default PipelineFilterPopover;
