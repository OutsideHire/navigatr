/**
 * TodaysPathView (SP-B2). The on-screen landing that renders the auto-built
 * "Today's Path" proposal.
 *
 * This is the primary Path landing when the rep has an origin and no active
 * path: a reviewable day assembled by `useTodaysPath` (SP-B1) from the pure
 * `assembleTodaysPath` (SP-A). It is RENDER + LOCAL-REVIEW only; it never
 * routes, sorts, or gates (that all lives in the assembler). The rep can:
 *   - see the proposal in run order, each stop showing one plain reason line
 *     (no tier chips, scores, or overdue ages); appointment times sit beside
 *     the name, and a "Why this order?" explainer describes the ordering;
 *   - REMOVE a flexible stop from the plan (local, pre-start);
 *   - "Add more nearby" to open the Find-near-me discovery;
 *   - the single hero action reads "Start driving", which hands the remaining
 *     FLEXIBLE stops back up to PathPage's existing create+start mechanism
 *     (appointments are calendar anchors shown in the plan, never created as
 *     merchant stops). An empty day instead shows "Build my day".
 *
 * The overflow list ("Won't fit today") is read-only here; wiring carry-over is
 * SP-D.
 */
import * as React from "react";
import { ArrowRight, CalendarClock, Loader2, MapPin, Navigation, Plus, RefreshCw, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/navigatr";
import type { OrderedStop, FlexibleStop } from "../lib/todaysPath";
import type { TodaysPathStatus } from "../hooks/useTodaysPath";
import { tierAccent } from "../lib/tierStyles";
import { reasonLine } from "../lib/reasonLine";

interface TodaysPathViewProps {
  /** Ordered run list (appointments interleaved with flexible stops) from useTodaysPath. */
  proposal: OrderedStop[];
  /** Flexible candidates that did not fit; displayed read-only for carry-over (SP-D). */
  overflow: FlexibleStop[];
  /** Assembler is still gathering its tiers. */
  isLoading: boolean;
  /** Non-"ok" statuses drive a non-blocking notice (needs_reconnect). */
  status: TodaysPathStatus;
  /** Start a path from the remaining flexible stops (appointments excluded). */
  onStart: (flexibleStops: OrderedStop[]) => void;
  /** Open the Find-near-me discovery to add more nearby stops. */
  onAddNearby: () => void;
  /** True while the create+start round-trip is in flight. */
  isStarting?: boolean;
}

/** Local-tz clock time, e.g. "10:30 AM". */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function TodaysPathView({
  proposal,
  overflow,
  isLoading,
  status,
  onStart,
  onAddNearby,
  isStarting = false,
}: TodaysPathViewProps) {
  // Local, pre-start removals: the rep can drop a flexible stop from the plan
  // before starting. Keyed by stop id; appointments can't be removed (they're
  // calendar anchors). Filtering here keeps useTodaysPath's assembler output
  // untouched. This is a view-only override.
  const [removed, setRemoved] = React.useState<ReadonlySet<string>>(() => new Set());

  const visibleProposal = React.useMemo(
    () => proposal.filter((s) => !(s.kind === "flexible" && removed.has(s.id))),
    [proposal, removed],
  );
  const visibleOverflow = React.useMemo(
    () => overflow.filter((s) => !removed.has(s.id)),
    [overflow, removed],
  );
  const flexibleStops = React.useMemo(
    () => visibleProposal.filter((s) => s.kind === "flexible"),
    [visibleProposal],
  );
  // How many auto-added "nearby" fills sit in the plan, and whether the day has
  // any committed stop (appointment/owed/due) at all. On a truly empty day the
  // "Build my day" button owns the messaging, so the count line is suppressed.
  const nearbyFillCount = React.useMemo(
    () => visibleProposal.filter((s) => s.tier === "nearby").length,
    [visibleProposal],
  );
  const hasCommitment = React.useMemo(
    () => visibleProposal.some((s) => s.tier !== "nearby"),
    [visibleProposal],
  );

  const handleRemove = React.useCallback((id: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const wrap = "mt-6 flex flex-col gap-4 self-stretch md:mx-auto md:w-full md:max-w-2xl";

  if (isLoading) {
    return (
      <div className={wrap}>
        <div className="mt-6 flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
          <p className="text-caption text-text-muted">Building today&apos;s path…</p>
        </div>
      </div>
    );
  }

  const empty = visibleProposal.length === 0 && visibleOverflow.length === 0;

  return (
    <div className={wrap}>
      {/* needs_reconnect is non-blocking: the plan still renders from whatever
          tiers resolved; the calendar tier is simply absent. */}
      {status === "needs_reconnect" && (
        <div className="flex items-center gap-2 rounded-radius-md border border-status-warning/40 bg-status-warning-bg px-3 py-2">
          <RefreshCw className="h-4 w-4 shrink-0 text-status-warning" aria-hidden />
          <p className="text-caption text-text-default">
            Reconnect your calendar to include today&apos;s meetings in the plan.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h2 className="text-heading-md text-text-default">Today&apos;s path</h2>
        <p className="text-body-md text-text-muted">
          {empty
            ? "Nothing owed, due, or nearby yet."
            : "Your day, prioritized. Review it, then start."}
        </p>
      </div>

      {empty ? (
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
            <MapPin className="h-6 w-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">You&apos;re all caught up</p>
            <p className="text-body-md text-text-muted">
              No follow-ups owed or due today, and no appointments on the calendar. Find
              some nearby businesses to prospect.
            </p>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddNearby}>
            Build my day
          </Button>
        </Card>
      ) : (
        <>
          {/* Hero Start: the rep's single most important daily action. Only when
              there's at least one flexible (drivable) stop to create; a plan that
              is all appointments has nothing to start as a merchant route. */}
          {flexibleStops.length > 0 && (
            <button
              type="button"
              onClick={() => onStart(flexibleStops)}
              disabled={isStarting}
              aria-label={`Start driving, ${flexibleStops.length} stop${flexibleStops.length === 1 ? "" : "s"}`}
              className={cn(
                "group flex w-full items-center gap-3 rounded-radius-lg px-4 py-3.5 text-left",
                "bg-brand-primary text-brand-primary-foreground shadow-sm",
                "transition-colors hover:bg-brand-primary-hover active:bg-brand-primary-pressed",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
                "disabled:cursor-not-allowed disabled:opacity-70",
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary-foreground/20">
                {isStarting ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Navigation className="h-5 w-5" aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-lg font-semibold leading-tight">Start driving</span>
                <span className="text-caption text-brand-primary-foreground/75">
                  {flexibleStops.length} stop{flexibleStops.length === 1 ? "" : "s"} to run
                </span>
              </span>
              <ArrowRight
                className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
          )}

          {/* One-sentence rationale for the order, on demand (FR-PATH-UX-14). */}
          <details className="text-caption text-text-subtle">
            <summary className="cursor-pointer select-none">Why this order?</summary>
            <p className="mt-1 text-text-muted">
              Appointments go where they are booked. Everything else is ordered by how long it has been,
              unless a place is well out of your way.
            </p>
          </details>

          {/* The proposal, in run order, each stop showing its plain reason line. */}
          <ol className="flex flex-col gap-1.5">
            {visibleProposal.map((stop, i) => (
              <ProposalRow
                key={`${stop.kind}-${stop.id}`}
                stop={stop}
                index={i}
                onRemove={stop.kind === "flexible" ? () => handleRemove(stop.id) : undefined}
              />
            ))}
          </ol>

          {/* State how many nearby stops were auto-added into open time, with a
              plain drop affordance (FR-PATH-UX-02). Suppressed on an empty day
              (handled by "Build my day") and when nothing was auto-filled. */}
          {hasCommitment && nearbyFillCount > 0 && (
            <p className="text-caption text-text-muted">
              {nearbyFillCount} new {nearbyFillCount === 1 ? "place was" : "places were"} added in your open time. Tap one to drop it.
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddNearby}>
              Add more nearby
            </Button>
          </div>

          {/* Overflow: stops that did not fit today. Read-only, and no explicit
              "carry" action is needed: past-due stays past-due, due-today becomes
              past-due, and nearby is re-discovered, so these reappear on their own
              the next time the rep builds a path. */}
          {visibleOverflow.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col">
                <span className="text-caption font-medium text-text-muted">
                  Won&apos;t fit today
                </span>
                <span className="text-caption text-text-subtle">
                  Still waiting for you tomorrow
                </span>
              </div>
              {visibleOverflow.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-radius-md border border-dashed border-border-default bg-surface-sunken/40 p-3 opacity-75"
                >
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full", tierAccent(s.tier).icon)}>
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-body-strong text-text-default">{s.name}</p>
                    <p className={cn("mt-0.5 text-caption", s.tier === "past_due" && s.ageDays != null && s.ageDays > 0 ? "text-status-warning" : "text-text-muted")}>
                      {reasonLine({
                        kind: "flexible",
                        tier: s.tier,
                        startAt: null,
                        ageDays: s.ageDays,
                        datePromisedToday: false,
                        hasPriorActivity: s.tier !== "nearby",
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── ProposalRow ──────────────────────────────────────────────────────

function ProposalRow({
  stop,
  index,
  onRemove,
}: {
  stop: OrderedStop;
  index: number;
  onRemove?: () => void;
}) {
  const accent = tierAccent(stop.tier);
  const isAppointment = stop.tier === "appointment";

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-radius-md border p-3",
        isAppointment ? accent.border : "border-border-subtle bg-surface-default",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold tabular-nums",
          accent.icon,
        )}
        aria-label={`stop ${index + 1}`}
      >
        {isAppointment ? <CalendarClock className="h-3.5 w-3.5" aria-hidden /> : index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-body-strong text-text-default">{stop.name}</p>
          {isAppointment && stop.startAt && (
            <span className="shrink-0 text-caption tabular-nums text-accent-violet">
              {fmtTime(stop.startAt)}
            </span>
          )}
        </div>
        {/* One plain reason line per row (FR-PATH-UX-05), appointments included. */}
        <p className={cn("mt-0.5 text-caption", stop.tier === "past_due" && stop.ageDays != null && stop.ageDays > 0 ? "text-status-warning" : "text-text-muted")}>
          {reasonLine({
            kind: stop.kind,
            tier: stop.tier,
            startAt: stop.startAt,
            ageDays: stop.ageDays,
            datePromisedToday: false,
            hasPriorActivity: stop.tier !== "nearby",
          })}
        </p>
      </div>

      {onRemove && (
        <Button
          variant="tertiary"
          size="sm"
          iconOnly
          leadingIcon={Trash2}
          aria-label={`Remove ${stop.name}`}
          onClick={onRemove}
        />
      )}
    </li>
  );
}
