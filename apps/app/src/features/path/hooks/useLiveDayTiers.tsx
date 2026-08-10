/**
 * useLiveDayTiers (SP-C3) - the ONE source of truth for the day's LIVE tiers:
 * appointments + located external meetings, past-due owed drop-ins, and
 * due-today drop-ins. These are the tiers that are NOT the persisted native
 * `path_stops` (SP-C1): they are read live from their hooks and never written
 * into the path. Extracted from ActivePathView (SP-C2) so both the Stops tab
 * (ActivePathView) and the guided Run view (RunningPath) render the SAME rows
 * with the SAME actions, rather than copy-pasting the tier assembly.
 *
 * It returns:
 *   - `rows`: ordered TieredStopRow[] (appointments, then past-due, then
 *     due-today) ready to drop into `TieredStopList`. Callers append their own
 *     native-stop rows after these.
 *   - `sheets`: the two reused action sheets (AppointmentOutcomeSheet +
 *     LogActivitySheet), rendered off internal open state. Drop this node
 *     anywhere in the tree.
 *   - `counts`: per-tier counts, handy for headers / empty-state decisions.
 *
 * Actions match across both surfaces: an appointment gets Open deal + (once
 * past) Log outcome via the reused AppointmentOutcomeSheet; a past-due /
 * due-today owed stop is an EXISTING deal, so it gets Open deal + Log drop-in
 * via the reused LogActivitySheet keyed by the deal id (never the create-deal
 * DropInSheet path). Logging a drop-in invalidates the owed / due-today query
 * keys so a resolved stop leaves the live list.
 */
import * as React from "react";
import { Check, CircleDashed, ClipboardList, DoorOpen, ExternalLink, Navigation } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/navigatr";
import { AppointmentOutcomeSheet } from "@/features/appointments/components/AppointmentOutcomeSheet";
import { LogActivitySheet } from "@/features/activities/components/LogActivitySheet";
import { useMeetingStops } from "./useMeetingStops";
import { useOwedVisits } from "./useOwedVisits";
import { useDueTodayVisits } from "./useDueTodayVisits";
import type { MeetingStop } from "../lib/meetingStops";
import type { OwedVisit, OwedVisitNoCoords } from "../lib/owedVisits";
import { directionsUrl } from "../lib/directionsUrl";
import { reasonLine } from "../lib/reasonLine";
import type { TieredStopRow } from "../components/TieredStopList";

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

export interface LiveDayTiers {
  /** Appointment + past-due + due-today rows, then a "No location yet" group of
   *  owed drop-ins that have no coordinates yet (shown but never routed), ordered
   *  for TieredStopList. */
  rows: TieredStopRow[];
  /** The reused AppointmentOutcomeSheet + LogActivitySheet, rendered off
   *  internal open state. Render this node anywhere in the tree. */
  sheets: React.ReactNode;
  counts: { appointments: number; pastDue: number; dueToday: number; noLocation: number };
}

/**
 * @param pathDate  the local calendar day (YYYY-MM-DD) whose live tiers to build.
 */
export function useLiveDayTiers(pathDate: string): LiveDayTiers {
  // The day's meetings (booked appointments + located external calendar events),
  // time-ordered, actionable per kind: appointments open the deal and log an
  // outcome; external meetings navigate and toggle a local done state.
  const { stops: meetingStops } = useMeetingStops(pathDate);
  // Owed / due-today follow-ups: existing deals the rep owes a drop-in. Rendered
  // LIVE (never persisted as path_stops). `useOwedVisits` returns the whole
  // opened window (earliest_at <= today), so keep only the PAST-DUE slice here;
  // due-today comes from its own disjoint band.
  const { owed, noLocation: owedNoLocation } = useOwedVisits(pathDate);
  const { dueToday, noLocation: dueTodayNoLocation } = useDueTodayVisits(pathDate);
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

  // Past-due = the strictly-before-today slice of the opened owed window (the
  // equal-to-today rows are the disjoint due-today tier). Compare on the
  // YYYY-MM-DD date part (earliestAt is a date).
  const pastDue = React.useMemo(
    () => owed.filter((v) => v.earliestAt.slice(0, 10) < pathDate),
    [owed, pathDate],
  );

  // No-location owed drop-ins: eligible follow-ups whose deal has no coordinates
  // yet, so they can be shown + acted on but never routed. A task whose window
  // opens today is read by BOTH useOwedVisits (.lte) and useDueTodayVisits (.eq),
  // so the same stub can arrive twice; dedup by taskId (first wins).
  const noLocation = React.useMemo<OwedVisitNoCoords[]>(() => {
    const byTask = new Map<string, OwedVisitNoCoords>();
    for (const s of [...(owedNoLocation ?? []), ...(dueTodayNoLocation ?? [])]) {
      if (!byTask.has(s.taskId)) byTask.set(s.taskId, s);
    }
    return [...byTask.values()];
  }, [owedNoLocation, dueTodayNoLocation]);

  // Invalidate the owed / due-today reads after logging a drop-in so the stop
  // leaves the live list once its follow-up is resolved.
  const handleLogged = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["path", "owed-visits"] });
    void queryClient.invalidateQueries({ queryKey: ["path", "due-today-visits"] });
  }, [queryClient]);

  // The ordered live-tier rows: appointments, then past-due, then due-today.
  // Each row carries its tier chip and the actions appropriate to its kind.
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
        reason: `You have a ${fmtTime(m.startAt)} here.`,
        dimmed,
        strikethrough: dimmed,
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
    const dealRow = (v: OwedVisit, tier: "past_due" | "due_today"): TieredStopRow => {
      const age = ageDaysSince(v.createdAt);
      return {
      key: `owed-${v.taskId}`,
      tier,
      name: v.name,
      detail: v.address ?? undefined,
      reason: reasonLine({
        kind: "flexible",
        tier,
        startAt: null,
        ageDays: age,
        datePromisedToday: false, // TODO(Robert): plumb date_source for the "promised" line
        hasPriorActivity: true,
      }),
      aging: tier === "past_due" && age > 0,
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
      };
    };
    for (const v of pastDue) out.push(dealRow(v, "past_due"));
    for (const v of dueToday) out.push(dealRow(v, "due_today"));

    // 4. No-location owed drop-ins - existing deals with no coordinates yet, so
    // they are shown + actionable (Open deal / Log drop-in) but NOT routed. The
    // caption states the "No location yet" fix instead of a route reason.
    for (const s of noLocation) {
      out.push({
        key: `nolocation-${s.taskId}`,
        tier: "no_location",
        name: s.name,
        detail: s.address ?? undefined,
        reason: "No location yet. Add an address to put it on your route.",
        actions: (
          <>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={ExternalLink}
              onClick={() => navigate(`/pipeline/${s.dealId}`)}
            >
              Open deal
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              leadingIcon={DoorOpen}
              onClick={() => setLogDealId(s.dealId)}
            >
              Log drop-in
            </Button>
          </>
        ),
      });
    }

    return out;
  }, [meetingStops, doneExternal, pastDue, dueToday, noLocation, navigate, toggleDone]);

  const sheets = (
    <>
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
    </>
  );

  return {
    rows,
    sheets,
    counts: {
      appointments: meetingStops.length,
      pastDue: pastDue.length,
      dueToday: dueToday.length,
      noLocation: noLocation.length,
    },
  };
}
