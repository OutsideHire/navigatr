/**
 * ActivePathView - THE single Today's-path home (no modal).
 *
 * This view is the rich home surface for the rep's current day's path. As of
 * SP-C2 the Stops tab renders EVERY tier of the day as ONE ordered, tiered,
 * actionable list (via the shared `TieredStopList`), in place of the old
 * fragmented layout (a separate owed-stops sibling above a meetings block above
 * the native route rows). The single list is ordered:
 *   1. Appointments + located external meetings (from `useMeetingStops`), each
 *      with its clock time. Appointments open the deal and (once past) log an
 *      outcome via the reused `AppointmentOutcomeSheet`; external meetings
 *      navigate + toggle a local "done".
 *   2. Past-due owed drop-ins (`useOwedVisits`, the strictly-before-today
 *      slice), each with its overdue age.
 *   3. Due-today drop-ins (`useDueTodayVisits`).
 *   4. Native nearby stops (the persisted `path_stops` from `useTodayPath`),
 *      with their existing visited / skip / remove / reopen actions.
 *
 * Owed / due-today stops are EXISTING deals, so their actions are "Open deal"
 * (navigate to the deal) + "Log drop-in" (the reused `LogActivitySheet` keyed
 * by the deal id) - never the create-deal DropInSheet path. They are rendered
 * LIVE from their hooks and never persisted as path_stops (SP-C1).
 *
 * A light progress header, the Start-route hero, an Add stops / Clear path
 * footer, and the route map bracket the list. When every native stop is
 * resolved the list swaps for the end-of-path PathSummary.
 */
import * as React from "react";
import { ArrowRight, Check, CircleDashed, ClipboardList, DoorOpen, ExternalLink, Navigation, Plus, SkipForward, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { formatDistance, haversineMeters } from "@/lib/distance";
import type { Disposition } from "@/lib/followUpScheduling";
import { labelForCategory } from "../mockData";
import { useTodayPath, todayISO } from "../hooks/useTodayPath";
import { useMeetingStops } from "../hooks/useMeetingStops";
import { useOwedVisits } from "../hooks/useOwedVisits";
import { useDueTodayVisits } from "../hooks/useDueTodayVisits";
import type { MeetingStop } from "../lib/meetingStops";
import type { OwedVisit } from "../lib/owedVisits";
import { routeStats, formatEta } from "../lib/routeStats";
import { directionsUrl } from "../lib/directionsUrl";
import { AppointmentOutcomeSheet } from "@/features/appointments/components/AppointmentOutcomeSheet";
import { LogActivitySheet } from "@/features/activities/components/LogActivitySheet";
import { MerchantMap } from "./MerchantMap";
import { PathSummary } from "./PathSummary";
import { TieredStopList, type TieredStopRow } from "./TieredStopList";
import type { StopStatus } from "../lib/pathTypes";

interface ActivePathViewProps {
  /** Rep position - route math + map center. */
  origin: { lat: number; lng: number };
  /** Open the discovery / "add stops" view. */
  onAddStops: () => void;
  /** Enter running mode (turn-by-turn route). */
  onStartRoute: () => void;
}

/** Local-tz clock time, e.g. "10:30 AM". */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Whole days between an ISO timestamp and now (floored, never negative) - the
 *  past-due staleness age, matching useTodaysPath's owed sort key. */
function ageDaysSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/** Native-stop status badge - the status-colored circle the old StopRow drew,
 *  passed to TieredStopList as a full badge override so the nearby tier keeps
 *  its number / check / skip treatment. */
function NativeBadge({ status, index }: { status: StopStatus; index: number }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold tabular-nums",
        status === "pending" && "bg-brand-primary text-brand-primary-foreground",
        status === "visited" && "bg-status-success text-text-inverse",
        status === "skipped" && "bg-surface-sunken text-text-muted",
      )}
      aria-label={`stop ${index + 1}, ${status}`}
    >
      {status === "visited" ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : status === "skipped" ? (
        <SkipForward className="h-3.5 w-3.5" aria-hidden />
      ) : (
        index + 1
      )}
    </span>
  );
}

export function ActivePathView({ origin, onAddStops, onStartRoute }: ActivePathViewProps) {
  const { stops, setStatus, remove, clear, isComplete } = useTodayPath();
  const pathDate = todayISO();
  // The day's meetings (booked appointments + located external calendar events),
  // time-ordered, actionable per kind: appointments open the deal and log an
  // outcome; external meetings navigate and toggle a local done state.
  const { stops: meetingStops } = useMeetingStops(pathDate);
  // Owed / due-today follow-ups: existing deals the rep owes a drop-in. Rendered
  // LIVE (never persisted as path_stops). `useOwedVisits` returns the whole
  // opened window (earliest_at <= today), so keep only the PAST-DUE slice here;
  // due-today comes from its own disjoint band.
  const { owed } = useOwedVisits(pathDate);
  const { dueToday } = useDueTodayVisits(pathDate);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The appointment meeting stop whose outcome sheet is open, if any. Reuses the
  // exact AppointmentOutcomeSheet the Activities page opens, so logging from the
  // Path runs the same recordOutcome flow.
  const [outcomeStop, setOutcomeStop] = React.useState<MeetingStop | null>(null);
  // The deal id whose Log-a-drop-in sheet is open, if any (owed / due-today).
  // Reuses LogActivitySheet keyed by dealId - these deals already exist, so we
  // never route them through the create-deal DropInSheet path.
  const [logDealId, setLogDealId] = React.useState<string | null>(null);
  // Client-only "done" state for external meetings: no persistence, no outcome.
  const [doneExternal, setDoneExternal] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggleDone = React.useCallback((id: string) => {
    setDoneExternal((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const stats = React.useMemo(
    () => routeStats(origin, stops.map((s) => ({ lat: s.lat, lng: s.lng }))),
    [origin, stops],
  );
  const routePath =
    stops.length > 0 ? [origin, ...stops.map((s) => ({ lat: s.lat, lng: s.lng }))] : undefined;

  const visited = stops.filter((s) => s.status === "visited").length;
  const skipped = stops.filter((s) => s.status === "skipped").length;
  const pending = stops.filter((s) => s.status === "pending").length;
  const complete = isComplete();

  // Past-due = the strictly-before-today slice of the opened owed window (the
  // equal-to-today rows are the disjoint due-today tier). Compare on the
  // YYYY-MM-DD date part (earliestAt is a date).
  const pastDue = React.useMemo(
    () => owed.filter((v) => v.earliestAt.slice(0, 10) < pathDate),
    [owed, pathDate],
  );

  // Leg distances: cursor starts at origin; each stop's leg is the hop from the
  // previous point, then the cursor advances to that stop.
  const legs = React.useMemo(() => {
    let cursor = origin;
    return stops.map((s) => {
      const d = haversineMeters(cursor, { lat: s.lat, lng: s.lng });
      cursor = { lat: s.lat, lng: s.lng };
      return d;
    });
  }, [stops, origin]);

  // Invalidate the owed / due-today reads after logging a drop-in so the stop
  // leaves the live list once its follow-up is resolved.
  const handleLogged = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["path", "owed-visits"] });
    void queryClient.invalidateQueries({ queryKey: ["path", "due-today-visits"] });
  }, [queryClient]);

  // The one ordered, tiered list: appointments, then past-due, due-today, and
  // finally the native nearby route stops. Each row carries its tier chip and
  // the actions appropriate to its kind.
  const rows = React.useMemo<TieredStopRow[]>(() => {
    const out: TieredStopRow[] = [];

    // 1. Appointments + located external meetings (already time-ordered).
    for (const m of meetingStops) {
      const done = m.kind === "external" && doneExternal.has(m.id);
      const dimmed = m.past || done;
      const canNavigate = m.lat != null && m.lng != null;
      out.push({
        key: `meeting-${m.id}`,
        tier: "appointment",
        external: m.kind === "external",
        name: m.title,
        timeLabel: fmtTime(m.startAt),
        dimmed,
        strikethrough: dimmed,
        chipOverride: dimmed ? "Ended" : undefined,
        detail:
          m.dealName || m.address ? (
            <>
              {m.dealName && <span className="block truncate">{m.dealName}</span>}
              {m.address && <span className="block truncate">{m.address}</span>}
            </>
          ) : undefined,
        actions:
          m.kind === "appointment" ? (
            <>
              {m.dealId && (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={ExternalLink}
                  onClick={() => navigate(`/pipeline/${m.dealId}`)}
                >
                  Open deal
                </Button>
              )}
              {m.past && m.appointmentId && m.dealId && (
                <Button
                  variant="tertiary"
                  size="sm"
                  leadingIcon={ClipboardList}
                  onClick={() => setOutcomeStop(m)}
                >
                  Log outcome
                </Button>
              )}
            </>
          ) : (
            <>
              {canNavigate && (
                <a
                  href={directionsUrl(m.lat as number, m.lng as number)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-radius-md border border-border-default px-3 py-1.5 text-caption font-medium text-text-default hover:bg-surface-sunken"
                >
                  <Navigation className="h-3.5 w-3.5" aria-hidden /> Navigate
                </a>
              )}
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={done ? CircleDashed : Check}
                onClick={() => toggleDone(m.id)}
              >
                {done ? "Mark not done" : "Mark done"}
              </Button>
            </>
          ),
      });
    }

    // 2 + 3. Owed (past-due) then due-today - existing deals: Open deal + Log
    // drop-in against that deal.
    const dealRow = (v: OwedVisit, tier: "past_due" | "due_today"): TieredStopRow => ({
      key: `owed-${v.taskId}`,
      tier,
      name: v.name,
      detail: v.address ?? undefined,
      ageDays: tier === "past_due" ? ageDaysSince(v.createdAt) : undefined,
      actions: (
        <>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={ExternalLink}
            onClick={() => navigate(`/pipeline/${v.dealId}`)}
          >
            Open deal
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            leadingIcon={DoorOpen}
            onClick={() => setLogDealId(v.dealId)}
          >
            Log drop-in
          </Button>
        </>
      ),
    });
    for (const v of pastDue) out.push(dealRow(v, "past_due"));
    for (const v of dueToday) out.push(dealRow(v, "due_today"));

    // 4. Native nearby stops - keep the existing visited / skip / remove / reopen.
    stops.forEach((s, i) => {
      const resolved = s.status !== "pending";
      out.push({
        key: `native-${s.merchantId}`,
        tier: "nearby",
        name: s.name,
        strikethrough: resolved,
        dimmed: resolved,
        badge: <NativeBadge status={s.status} index={i} />,
        detail: (
          <>
            <span className="block truncate">
              {labelForCategory(s.category)}
              {s.address ? ` · ${s.address}` : ""}
            </span>
            <span className="mt-1 block text-text-subtle tabular-nums">
              {i === 0 ? "From start" : "From prev stop"}: {formatDistance(legs[i] ?? 0)}
            </span>
          </>
        ),
        actions:
          s.status === "pending" ? (
            <>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={Check}
                onClick={() => {
                  setStatus(s.merchantId, "visited");
                  toast.success(`Marked ${s.name} as visited`);
                }}
              >
                Mark visited
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={SkipForward}
                onClick={() => {
                  setStatus(s.merchantId, "skipped");
                  toast(`Skipped ${s.name}`);
                }}
              >
                Skip
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={Trash2}
                onClick={() => {
                  remove(s.merchantId);
                  toast(`Removed ${s.name} from path`);
                }}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button
              variant="tertiary"
              size="sm"
              leadingIcon={CircleDashed}
              onClick={() => setStatus(s.merchantId, "pending")}
            >
              Reopen
            </Button>
          ),
      });
    });

    return out;
  }, [meetingStops, doneExternal, pastDue, dueToday, stops, legs, navigate, setStatus, remove, toggleDone]);

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[1.4fr_1fr]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-heading-md text-text-default">Today&apos;s path</h2>
          <span className="text-caption tabular-nums text-text-muted">
            {visited}/{stats.stopCount} visited · {formatDistance(stats.totalRouteMeters)} · {formatEta(stats.etaMinutes)}
          </span>
        </div>

        {complete ? (
          <PathSummary
            visitedCount={visited}
            skippedCount={skipped}
            totalStops={stops.length}
            routeMeters={stats.totalRouteMeters}
            dispositions={stops
              .map((s) => s.disposition)
              .filter((d): d is Disposition => d != null)}
            dealsCreated={stops.filter((s) => s.dealCreated).length}
            onViewPipeline={() => navigate("/pipeline")}
            onNewPath={() => {
              void clear();
            }}
          />
        ) : (
          <>
            {/* Hero CTA - the rep's single most important daily action. Full-width,
                saturated brand fill, icon chip + forward arrow so it reads as
                "launch", not just another button. The header already carries
                distance/ETA, so the subline stays action-framed ("stops to go")
                rather than repeating those metrics. */}
            {pending > 0 && (
              <button
                type="button"
                onClick={onStartRoute}
                aria-label={`Start route - ${pending} stop${pending === 1 ? "" : "s"} to go`}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-radius-lg px-4 py-3.5 text-left",
                  "bg-brand-primary text-brand-primary-foreground shadow-sm",
                  "transition-colors hover:bg-brand-primary-hover active:bg-brand-primary-pressed",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary-foreground/20">
                  <Navigation className="h-5 w-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-lg font-semibold leading-tight">Start route</span>
                  <span className="text-caption text-brand-primary-foreground/75">
                    {pending} stop{pending === 1 ? "" : "s"} to go
                  </span>
                </span>
                <ArrowRight
                  className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
            )}

            {/* The one ordered, tiered, actionable list (SP-C2). */}
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
              <TieredStopList rows={rows} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddStops}>
                Add stops
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={Trash2}
                onClick={() => {
                  if (window.confirm("Clear the whole path?")) void clear();
                }}
              >
                Clear path
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="min-h-[280px]">
        <MerchantMap position={origin} merchants={[]} routePath={routePath} />
      </div>

      {/* Reused, not rebuilt: the same outcome capture the Activities page uses.
          Guarded by the onLogOutcome wiring above, so dealId/appointmentId are
          always present here. hasFutureAppointment is false: this meeting stop
          is itself the appointment being logged, and the Path day view does not
          track other future appointments on the deal. */}
      {outcomeStop && outcomeStop.dealId && outcomeStop.appointmentId && (
        <AppointmentOutcomeSheet
          open
          onOpenChange={(o) => {
            if (!o) setOutcomeStop(null);
          }}
          appointmentId={outcomeStop.appointmentId}
          dealId={outcomeStop.dealId}
          merchantName={outcomeStop.dealName ?? outcomeStop.title}
          hasFutureAppointment={false}
        />
      )}

      {/* Reused, not rebuilt: the same activity-logging sheet the pipeline / deal
          screens use, keyed by the owed / due-today deal id and opened straight
          to the drop-in form. These deals already exist, so this never touches
          the create-deal DropInSheet path. */}
      {logDealId && (
        <LogActivitySheet
          open
          onOpenChange={(o) => {
            if (!o) setLogDealId(null);
          }}
          dealId={logDealId}
          defaultType="drop_in"
          onLogged={handleLogged}
        />
      )}
    </div>
  );
}
