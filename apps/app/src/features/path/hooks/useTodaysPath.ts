/**
 * useTodaysPath (SP-B1) - the composing hook for the auto-built Today's Path.
 *
 * THIN by design: it gathers the four input tiers from existing hooks, adapts
 * each to the SP-A assembler's input shapes, and calls the pure
 * `assembleTodaysPath`. All ordering/selection/fit logic lives in the assembler;
 * this hook never routes, sorts, or gates. It only maps + calls.
 *
 * The four tiers:
 *   1. Appointments (fixed anchors) - today's non-past LOCATED meeting stops
 *      from `useMeetingStops` (navigatr appointments + external calendar stops).
 *   2. Owed drop-ins (past-due) - `useOwedVisits`, mapped to OwedCandidate.
 *      `ageDays` is the follow-up's staleness (now - createdAt); the assembler
 *      re-sorts owed oldest-first internally, so input order does not matter.
 *      `useOwedVisits` reads the whole OPENED window (earliest_at <= today), so
 *      the owed tier here keeps only the strictly-before slice (earliest_at <
 *      today); the equal-to-today slice belongs to tier 3.
 *   3. Due-today drop-ins / follow-ups - `useDueTodayVisits`, the sibling that
 *      reads the window-opens-TODAY band (earliest_at === today) through the
 *      same task->deal->coords join. The two bands are disjoint on earliest_at
 *      (strictly-before vs equal-to today), so a task is in exactly one tier and
 *      is never double-counted.
 *   4. Nearby pool (Find near me fill) - the discovered prospects from
 *      `useMerchants` (already ICP-filtered, non-chain, and pipeline-deduped
 *      server-side), mapped to NearbyCandidate.
 *
 * Not a pure fn: it reads three hooks. `now` is passed through so tests can pin
 * the clock; it defaults to the current time. `now` also derives the local
 * `pathDate` the tier hooks key on, so the whole composition is deterministic
 * for a given `now`.
 */
import { useMemo, useState } from "react";
import type { LatLng } from "@/lib/distance";
import { useMeetingStops } from "./useMeetingStops";
import { useOwedVisits } from "./useOwedVisits";
import { useDueTodayVisits } from "./useDueTodayVisits";
import { useMerchants } from "./useMerchants";
import { usePathEndOfDayMinutes } from "./usePathPreferences";
import { DEFAULT_END_OF_DAY_MINUTES } from "../lib/pathCapacityDefaults";
import {
  assembleTodaysPath,
  type OrderedStop,
  type FlexibleStop,
  type PathAppointment,
  type OwedCandidate,
  type DueTodayCandidate,
  type NearbyCandidate,
} from "../lib/todaysPath";
import type { OwedVisitNoCoords } from "../lib/owedVisits";

/** Enough state for the UI to pick the right empty state. */
export type TodaysPathStatus = "ok" | "no_origin" | "needs_reconnect";

export interface UseTodaysPathResult {
  proposal: OrderedStop[];
  overflow: FlexibleStop[];
  /** Owed drop-ins whose deal has no coordinates yet: NOT routable, so never in
   *  `proposal`/`overflow`, but surfaced so the landing can show them under a
   *  "No location yet" group (deduped by taskId across the owed + due-today
   *  bands). A later task geocodes deals with an address so they graduate. */
  noLocation: OwedVisitNoCoords[];
  /** Budget minutes still open, for the capacity sentence (FR-PATH-UX-10). */
  remainingMin: number;
  /** Working-window close hour (0..24), for the full-day sentence. */
  windowEndHour: number;
  /** Preformatted clock (e.g. "9:15") of the day's effective start, for the
   *  "Your day" landing subhead's "Starts at" clause (v2.2 A6). Null when there
   *  is no origin / nothing assembled yet. */
  startsAt: string | null;
  status: TodaysPathStatus;
  isLoading: boolean;
}

/** Working-day open hour. Mirrors the assembler's DEFAULT_WINDOW.startHour so the
 *  budget starts from the same morning open once the rep EOD is threaded in. */
const DEFAULT_WINDOW_START_HOUR = 9;

const MS_PER_DAY = 86_400_000;

/** Local calendar day (yyyy-mm-dd) of an instant. The tier hooks
 *  (`useMeetingStops`, `useOwedVisits`) bracket their day off this same local
 *  date, so deriving it from `now` keeps the whole composition deterministic. */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local-tz 12-hour clock with no am/pm, e.g. "9:15", "11:40" (v2.2 A6 subhead
 *  style, matching the day-capacity sentences). Returns null for an unparseable
 *  instant so the subhead falls back to the count alone. */
function fmtClock(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  const hr12 = h % 12 === 0 ? 12 : h % 12;
  return `${hr12}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Whole days between an ISO timestamp and now (floored, never negative). Used
 *  as the owed staleness age the assembler sorts on. */
function ageDaysSince(iso: string, nowMs: number): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((nowMs - then) / MS_PER_DAY));
}

/**
 * Compose the four tiers, adapt them to the assembler, and return its proposal
 * + overflow with a status the UI can branch an empty state on.
 *
 * @param origin the run's start point, or null (no located origin yet).
 * @param nowOverride ISO instant, for tests that pin the clock. In production it
 *               is omitted: the hook captures `now` ONCE per instance (see below)
 *               so the whole composition stays referentially stable across
 *               renders. `now` drives the budget AND the local `pathDate` the tier
 *               hooks read.
 */
export function useTodaysPath(
  origin: LatLng | null,
  nowOverride?: string,
): UseTodaysPathResult {
  // Capture `now` ONCE per hook instance rather than reading the clock on every
  // render. A per-render default (`new Date().toISOString()`) changed the memo's
  // `now` dep every render, so `proposal`/`overflow` were re-derived with a fresh
  // array identity each time. That churn reset the entry landing's local review
  // state (TodaysPathView keys `workingProposal`/`poolCursor` off `proposal`
  // identity) and is the "needs a manual refresh to populate" QA report. Mirrors
  // RunningPath's stable `nowIso` for the running view. Tests pin it via nowOverride.
  const [capturedNow] = useState(() => new Date().toISOString());
  const now = nowOverride ?? capturedNow;
  const pathDate = localDateOf(now);

  // Tier 1: fixed calendar anchors.
  const meetings = useMeetingStops(pathDate, now);
  // Tier 2: opened owed drop-ins (past-due slice kept below).
  const owed = useOwedVisits(pathDate);
  // Tier 3: drop-ins whose window opens today.
  const dueTodayVisits = useDueTodayVisits(pathDate);
  // Tier 4: nearby discovery fill (disabled internally when origin is null).
  const nearby = useMerchants(origin);

  // Per-rep end-of-day (minutes from midnight), or the global default when the
  // rep has no override. Feeds the assembler's window end so `remainingMin` /
  // `windowEndHour` reflect the rep's actual EOD, not the hardcoded 17:00.
  const endOfDayMinutes = usePathEndOfDayMinutes();
  const eodMinutes = endOfDayMinutes.data ?? DEFAULT_END_OF_DAY_MINUTES;

  return useMemo<UseTodaysPathResult>(() => {
    // No-location owed drop-ins: eligible follow-ups whose deal has no coords
    // yet. A task whose window opens today is read by BOTH useOwedVisits (.lte)
    // and useDueTodayVisits (.eq), so the same stub can arrive twice; dedup by
    // taskId (first wins). Independent of origin, so it is returned in every
    // branch below - a coordinate-less drop-in must never silently vanish.
    const noLocation: OwedVisitNoCoords[] = (() => {
      const byTask = new Map<string, OwedVisitNoCoords>();
      for (const s of [...owed.noLocation, ...dueTodayVisits.noLocation]) {
        if (!byTask.has(s.taskId)) byTask.set(s.taskId, s);
      }
      return [...byTask.values()];
    })();

    const status: TodaysPathStatus =
      origin == null
        ? "no_origin"
        : meetings.status === "needs_reconnect"
          ? "needs_reconnect"
          : "ok";

    const isLoading =
      origin != null &&
      (meetings.isLoading || owed.isLoading || dueTodayVisits.isLoading || nearby.isLoading);

    // With no origin the assembler has nothing to route from; return empty.
    if (origin == null) {
      return {
        proposal: [],
        overflow: [],
        noLocation,
        remainingMin: 0,
        windowEndHour: Math.floor(eodMinutes / 60),
        startsAt: null,
        status,
        isLoading: false,
      };
    }

    const nowMs = Date.parse(now);

    // Tier 1 → PathAppointment[]: today's non-past, LOCATED meetings only. Kind
    // ("appointment" | "external") already matches AppointmentKind.
    const appointments: PathAppointment[] = meetings.stops
      .filter((s) => !s.past && s.lat != null && s.lng != null)
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        dealId: s.dealId,
        startAt: s.startAt,
        endAt: s.endAt,
        lat: s.lat,
        lng: s.lng,
      }));

    // Tier 2 → OwedCandidate[]. id is the task id (unique per owed follow-up);
    // ageDays is the follow-up's staleness. The assembler re-sorts these.
    // `useOwedVisits` returns the whole opened window (earliest_at <= today), so
    // keep only the PAST-DUE slice (earliest_at strictly before today); the
    // equal-to-today rows are the due-today tier and would otherwise
    // double-count. Compare on the YYYY-MM-DD date part (earliestAt is a date).
    const owedCandidates: OwedCandidate[] = owed.owed
      .filter((v) => v.earliestAt.slice(0, 10) < pathDate)
      .map((v) => ({
        id: v.taskId,
        dealId: v.dealId,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        ageDays: ageDaysSince(v.createdAt, nowMs),
      }));

    // Tier 3 → DueTodayCandidate[]. Drop-ins whose window opens TODAY, sourced
    // by `useDueTodayVisits` (the earliest_at === today band) through the same
    // task->deal->coords join as owed. Already coord-resolved (unroutable rows
    // are dropped in the assembler), and disjoint from the owed tier by band.
    const dueToday: DueTodayCandidate[] = dueTodayVisits.dueToday.map((v) => ({
      id: v.taskId,
      dealId: v.dealId,
      name: v.name,
      lat: v.lat,
      lng: v.lng,
    }));

    // Tier 4 → NearbyCandidate[]. Discovered prospects are cold leads with no
    // deal yet, so dealId is null; already pipeline-deduped server-side.
    const nearbyPool: NearbyCandidate[] = nearby.merchants.map((m) => ({
      id: m.id,
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      dealId: null,
    }));

    const { proposal, overflow, remainingMin, windowEndHour, startsAtIso } = assembleTodaysPath(
      {
        appointments,
        owed: owedCandidates,
        dueToday,
        nearbyPool,
        origin,
        // Thread the rep's EOD as a minute-precise window close; endHour is the
        // coarse fallback the assembler floors to for the label.
        dayWindow: {
          startHour: DEFAULT_WINDOW_START_HOUR,
          endHour: Math.floor(eodMinutes / 60),
          endMinutes: eodMinutes,
        },
      },
      now,
    );

    return {
      proposal,
      overflow,
      noLocation,
      remainingMin,
      windowEndHour,
      startsAt: fmtClock(startsAtIso),
      status,
      isLoading,
    };
  }, [origin, now, pathDate, eodMinutes, meetings.stops, meetings.status, meetings.isLoading, owed.owed, owed.noLocation, owed.isLoading, dueTodayVisits.dueToday, dueTodayVisits.noLocation, dueTodayVisits.isLoading, nearby.merchants, nearby.isLoading]);
}
