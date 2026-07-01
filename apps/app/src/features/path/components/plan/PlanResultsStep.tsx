/**
 * PlanResultsStep — step 3 of the Plan-a-Path wizard.
 *
 * Discovered businesses near the resolved origin (useMerchants runs in the parent
 * and hands the merchants + loading/error in). Each card exposes:
 *   - "Add to today's path" — toggles the merchant in the wizard's in-progress stop
 *     set (add / remove).
 *   - "Log drop-in" — opens the shared DropInSheet for that merchant.
 *
 * A sticky footer shows "N stops added" and a "Review path" action (enabled when
 * N ≥ 1). MerchantList is the empty/loading base; when there are results we render
 * action cards so the per-card Add/Log affordances live on each row (MerchantList
 * stays unchanged / props-only).
 */
import { Check, Loader2, MapPinOff, Plus, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Card } from "@/components/navigatr";
import { labelForCategory, type Merchant } from "../../mockData";
import { formatDistance } from "@/lib/distance";
import type { MerchantWithDistance } from "../MerchantList";

export interface PlanResultsStepProps {
  merchants: MerchantWithDistance[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** IDs currently in the wizard's in-progress stop set. */
  addedIds: Set<string>;
  onToggleStop: (merchant: Merchant) => void;
  onLogDropIn: (merchant: Merchant) => void;
}

export function PlanResultsStep({
  merchants,
  isLoading,
  isError,
  onRetry,
  addedIds,
  onToggleStop,
  onLogDropIn,
}: PlanResultsStepProps) {
  if (isLoading) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
        <p className="text-caption text-text-muted">Discovering businesses nearby…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <Card padding="lg" className="mt-6 flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-warning-bg text-status-warning">
          <MapPinOff className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-heading-sm text-text-default">Couldn&apos;t load businesses</p>
          <p className="text-body-md text-text-muted">
            Something went wrong reaching the discovery service. Try again in a moment.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </Card>
    );
  }

  if (merchants.length === 0) {
    return (
      <Card padding="lg" className="mt-6 flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
          <MapPinOff className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-heading-sm text-text-default">No businesses match</p>
          <p className="text-body-md text-text-muted">
            Go back and try a wider radius, a different area, or more business types.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:mx-auto md:w-full md:max-w-2xl">
      {merchants.map((m) => {
        const added = addedIds.has(m.id);
        return (
          <Card key={m.id} padding="md" className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-body-strong text-text-default">{m.name}</span>
                  {m.isChain && (
                    <Badge kind="priority-low">
                      {m.chainBrandName ? `Chain · ${m.chainBrandName}` : "Chain"}
                    </Badge>
                  )}
                </span>
                <span className="text-caption text-text-muted">
                  {labelForCategory(m.category)}
                  {m.address ? ` · ${m.address}` : ""}
                </span>
              </div>
              <span className="shrink-0 text-caption tabular-nums text-text-muted">
                {formatDistance(m.distanceMeters)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant={added ? "secondary" : "primary"}
                size="sm"
                leadingIcon={added ? Check : Plus}
                onClick={() => onToggleStop(m)}
                aria-pressed={added}
                className={cn("flex-1", added && "text-status-success")}
              >
                {added ? "Added" : "Add to today's path"}
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={Radio}
                onClick={() => onLogDropIn(m)}
              >
                Log drop-in
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export default PlanResultsStep;
