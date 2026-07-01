/**
 * PlanReviewStep — step 4 of the Plan-a-Path wizard.
 *
 * The ordered stop list the rep will save. Per stop: position, name/category,
 * remove, and keyboard-accessible up/down reorder controls. "Add more stops"
 * returns to the results step.
 *
 * Reorder: the repo has no shared drag-to-reorder primitive (dnd-kit is used
 * inline only in the pipeline Kanban), so per the spec we ship accessible up/down
 * move buttons as the baseline — DnD is a polish follow-up.
 *
 * Saving is the parent's Continue action (createPath today + addStops in this
 * order); this component just renders the reviewed order + fires reorder/remove.
 */
import { ArrowDown, ArrowUp, Plus, Route as RouteIcon, X } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { labelForCategory, type Merchant } from "../../mockData";

export interface PlanReviewStepProps {
  /** Stops in reviewed (save) order. */
  stops: Merchant[];
  onRemove: (id: string) => void;
  /** Move the stop at `index` up (toward the front) or down. */
  onMove: (index: number, direction: "up" | "down") => void;
  onAddMore: () => void;
}

export function PlanReviewStep({ stops, onRemove, onMove, onAddMore }: PlanReviewStepProps) {
  return (
    <div className="flex flex-col gap-4 md:mx-auto md:w-full md:max-w-2xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-md text-text-default">Review your path</h2>
        <p className="text-body-md text-text-muted">
          {stops.length} {stops.length === 1 ? "stop" : "stops"} · reorder or remove before saving. We&apos;ll
          optimize the route when you save.
        </p>
      </div>

      {stops.length === 0 ? (
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
            <RouteIcon className="h-6 w-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">No stops yet</p>
            <p className="text-body-md text-text-muted">Add some businesses to review your path.</p>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddMore}>
            Add stops
          </Button>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <ol className="flex flex-col">
            {stops.map((m, i) => (
              <li
                key={m.id}
                className="flex items-center gap-3 px-4 py-3 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border-subtle"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-caption font-semibold tabular-nums text-text-default">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-strong text-text-default">{m.name}</span>
                  <span className="truncate text-caption text-text-muted">
                    {labelForCategory(m.category)}
                    {m.address ? ` · ${m.address}` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMove(i, "up")}
                    disabled={i === 0}
                    aria-label={`Move ${m.name} up`}
                    className="rounded-radius-sm p-2 text-text-muted hover:text-text-default disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(i, "down")}
                    disabled={i === stops.length - 1}
                    aria-label={`Move ${m.name} down`}
                    className="rounded-radius-sm p-2 text-text-muted hover:text-text-default disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(m.id)}
                    aria-label={`Remove ${m.name}`}
                    className="rounded-radius-sm p-2 text-text-muted hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {stops.length > 0 && (
        <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddMore} className="self-start">
          Add more stops
        </Button>
      )}
    </div>
  );
}

export default PlanReviewStep;
