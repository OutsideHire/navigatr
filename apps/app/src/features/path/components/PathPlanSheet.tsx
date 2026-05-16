/**
 * PathPlanSheet — the rep's queued drop-in route.
 *
 * Bottom sheet on mobile, centered modal on desktop (same Radix shell
 * as MerchantDetailSheet). Shows the queued stops in nearest-neighbor
 * order from the rep's current position, with each stop's status,
 * distance from the prior point, and quick actions.
 *
 * Actions per pending stop:
 *   Mark visited  → flip to visited (logged in mock store)
 *   Skip          → flip to skipped
 *   Remove        → drop from the queue entirely
 *
 * When every stop is resolved (no pending), we render an end-of-path
 * summary card: total visited, skipped, total route distance.
 * Tapping "Start over" clears the queue.
 *
 * The route line itself is drawn on the main /path map (caller passes
 * routePath to MerchantMap based on this same nearest-neighbor order).
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  CircleDashed,
  MapPin,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/navigatr";
import { formatDistance, haversineMeters, type LatLng } from "@/lib/distance";
import { CATEGORY_LABEL, type Merchant } from "../mockData";
import { usePathQueue, type StopStatus } from "../hooks/usePathQueue";

export interface PathPlanSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rep's current position — used as the route origin. */
  origin: LatLng;
  /** Full merchant list so we can resolve queued IDs to records. */
  allMerchants: Merchant[];
  /** Ordered list of merchants (post-NN), matching the route polyline
   *  the parent draws on the map. We pre-order in the parent so the
   *  sheet and the map agree. */
  orderedStops: Merchant[];
}

export function PathPlanSheet({
  open,
  onOpenChange,
  origin,
  allMerchants: _allMerchants,
  orderedStops,
}: PathPlanSheetProps) {
  const stops = usePathQueue((s) => s.stops);
  const setStatus = usePathQueue((s) => s.setStatus);
  const remove = usePathQueue((s) => s.remove);
  const clear = usePathQueue((s) => s.clear);
  const isComplete = usePathQueue((s) => s.isComplete());

  // Compute leg distances against the visit order. First leg = origin →
  // first stop. Subsequent legs = previous stop → next stop.
  const legs = React.useMemo(() => {
    let cursor = origin;
    return orderedStops.map((m) => {
      const d = haversineMeters(cursor, { lat: m.lat, lng: m.lng });
      cursor = { lat: m.lat, lng: m.lng };
      return d;
    });
  }, [orderedStops, origin]);

  const totalMeters = legs.reduce((a, b) => a + b, 0);

  const statusOf = (id: string): StopStatus | undefined =>
    stops.find((s) => s.merchantId === id)?.status;

  const visitedCount = stops.filter((s) => s.status === "visited").length;
  const skippedCount = stops.filter((s) => s.status === "skipped").length;
  const pendingCount = stops.filter((s) => s.status === "pending").length;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-surface-default text-text-default shadow-card-hover",
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:rounded-radius-lg sm:max-h-[80vh]",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden>
            <div className="h-1 w-10 rounded-radius-full bg-border-default" />
          </div>

          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-2 px-5 pb-2 pt-3 sm:pt-5">
            <div className="flex min-w-0 flex-col gap-1">
              <Dialog.Title className="text-heading-sm text-text-default">Today&apos;s path</Dialog.Title>
              <p className="text-caption text-text-muted">
                {orderedStops.length} {orderedStops.length === 1 ? "stop" : "stops"} ·{" "}
                <span className="tabular-nums">{formatDistance(totalMeters)}</span> total ·
                {" "}{pendingCount} pending
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
            {orderedStops.length === 0 ? (
              <Card padding="lg" className="flex flex-col items-center gap-2 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
                  <MapPin className="h-6 w-6" aria-hidden />
                </span>
                <p className="text-body-strong text-text-default">No stops yet</p>
                <p className="text-caption text-text-muted">
                  Tap any merchant pin or list row and choose &ldquo;Add to today&apos;s path.&rdquo;
                </p>
              </Card>
            ) : (
              <>
                {isComplete && (
                  <Card padding="md" className="bg-status-success-bg">
                    <p className="text-body-strong text-text-default">Path complete</p>
                    <p className="mt-1 text-caption text-text-muted">
                      {visitedCount} visited · {skippedCount} skipped ·{" "}
                      <span className="tabular-nums">{formatDistance(totalMeters)}</span> walked
                    </p>
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => {
                        clear();
                        toast.success("Path cleared. Ready for the next route.");
                      }}
                      className="mt-2"
                    >
                      Start a new path
                    </Button>
                  </Card>
                )}

                {orderedStops.map((m, i) => {
                  const status = statusOf(m.id) ?? "pending";
                  const legDist = legs[i] ?? 0;
                  return (
                    <StopRow
                      key={m.id}
                      index={i + 1}
                      merchant={m}
                      status={status}
                      legDistanceMeters={legDist}
                      onMarkVisited={() => {
                        setStatus(m.id, "visited");
                        toast.success(`Marked ${m.name} as visited`);
                      }}
                      onSkip={() => {
                        setStatus(m.id, "skipped");
                        toast(`Skipped ${m.name}`);
                      }}
                      onRemove={() => {
                        remove(m.id);
                        toast(`Removed ${m.name} from path`);
                      }}
                      onReopen={() => setStatus(m.id, "pending")}
                    />
                  );
                })}
              </>
            )}
          </div>

          {/* Footer — clear all is the only global action for sprint 1 */}
          {orderedStops.length > 0 && !isComplete && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={Trash2}
                onClick={() => {
                  if (confirm("Clear the whole path?")) clear();
                }}
              >
                Clear path
              </Button>
              <span className="text-caption text-text-muted">
                {visitedCount}/{orderedStops.length} visited
              </span>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── StopRow ──────────────────────────────────────────────────────────

function StopRow({
  index,
  merchant,
  status,
  legDistanceMeters,
  onMarkVisited,
  onSkip,
  onRemove,
  onReopen,
}: {
  index: number;
  merchant: Merchant;
  status: StopStatus;
  legDistanceMeters: number;
  onMarkVisited: () => void;
  onSkip: () => void;
  onRemove: () => void;
  onReopen: () => void;
}) {
  const isResolved = status !== "pending";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-radius-md border border-border-subtle bg-surface-default p-3",
        status === "visited" && "opacity-75",
        status === "skipped" && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Number badge — gets a check / X / dashed-circle to mirror status */}
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold tabular-nums",
            status === "pending" && "bg-brand-primary text-brand-primary-foreground",
            status === "visited" && "bg-status-success text-text-inverse",
            status === "skipped" && "bg-surface-sunken text-text-muted",
          )}
          aria-label={`stop ${index}, ${status}`}
        >
          {status === "visited" ? <Check className="h-3.5 w-3.5" aria-hidden /> :
           status === "skipped" ? <SkipForward className="h-3.5 w-3.5" aria-hidden /> :
           index}
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <p className={cn("truncate text-body-strong text-text-default", isResolved && "line-through")}>
            {merchant.name}
          </p>
          <p className="text-caption text-text-muted">
            {CATEGORY_LABEL[merchant.category]} · {merchant.address}
          </p>
          <p className="mt-1 text-caption text-text-subtle tabular-nums">
            {index === 1 ? "From start" : "From prev stop"}: {formatDistance(legDistanceMeters)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5 pl-10">
        {status === "pending" ? (
          <>
            <Button variant="primary" size="sm" leadingIcon={Check} onClick={onMarkVisited}>
              Mark visited
            </Button>
            <Button variant="tertiary" size="sm" leadingIcon={SkipForward} onClick={onSkip}>
              Skip
            </Button>
            <Button variant="tertiary" size="sm" leadingIcon={Trash2} onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <Button variant="tertiary" size="sm" leadingIcon={CircleDashed} onClick={onReopen}>
            Reopen
          </Button>
        )}
      </div>
    </div>
  );
}

export default PathPlanSheet;
