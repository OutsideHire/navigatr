import type { LatLng } from "@/lib/distance";
import type { BandPosition } from "./classD";
import { driveMinutesBetween } from "./driveTime";
import { dwellMinutesForKind } from "./pathCapacityDefaults";
import { reasonLine, stopLabel, lastVisitContext } from "./reasonLine";
import {
  interleaveAroundAnchors,
  type AnchorLike,
  type FlexibleLike,
} from "./interleaveAroundAnchors";

/**
 * FR-PATH-UX-06. Merge the whole day (appointments, external meetings, owed
 * drop-ins, due-today, native nearby) into ONE uniform ordered array of
 * "driving cards", each carrying its reason line, arrival/drive estimates, and
 * the refs needed to log an outcome. Presentation only: pure logic, no React,
 * no re-optimization of the order the app already composes elsewhere.
 */

export type DrivingCardKind = "appointment" | "external" | "owed" | "nearby";

export interface DrivingCard {
  id: string;
  kind: DrivingCardKind;
  name: string;
  address: string | null;
  /** Left-rail category label (v2.2 B 4.5): "appointment" | "you promised" |
   *  "anytime" | "on the way", via stopLabel. */
  label: string;
  /** One plain DETAIL sentence (v2.2 B 4.5.1), via reasonLine. May be empty
   *  (an appointment with no contact). */
  reason: string;
  /** "Last time, {outcome}." or null when no prior outcome is known. */
  lastVisit: string | null;
  /** Exact clock time for appointments ("3:00 PM"); "around {time}" for flexible. */
  arriveLabel: string;
  /** Human drive estimate to this card from the previous location, e.g. "12 min". */
  driveMinLabel: string;
  /** Refs for logging. Exactly the ones relevant to the kind are non-null. */
  dealId: string | null;
  appointmentId: string | null;
  merchantId: string | null;
  lat: number | null;
  lng: number | null;
  /** The follow-up's band position (v2.2 B 4.6), for the run map's aging color
   *  via `agingStateFromBand`. Owed cards carry it; meetings/nearby leave it
   *  undefined (no band -> neutral). */
  bandPosition?: BandPosition;
}

export interface DrivingMeetingInput {
  id: string;
  kind: "appointment" | "external";
  title: string;
  address?: string | null;
  dealId?: string | null;
  appointmentId?: string | null;
  startAt: string; // ISO
  endAt?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Appointment contact for the detail sentence (v2.2 B 4.5.1). Not plumbed on
   *  every surface yet -> empty sentence when absent. */
  contactName?: string | null;
}
export interface DrivingOwedInput {
  taskId: string;
  dealId: string;
  name: string;
  address?: string | null;
  ageDays: number;
  lat?: number | null;
  lng?: number | null;
  /** Asserted follow-up date (date_source "asserted") -> "you promised". */
  datePromised?: boolean;
  /** Band position for the run map's aging color (v2.2 B 4.6). */
  bandPosition?: BandPosition;
}
export interface DrivingDueTodayInput {
  taskId: string;
  dealId: string;
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Asserted follow-up date (date_source "asserted") -> "you promised". */
  datePromised?: boolean;
  /** Band position for the run map's aging color (v2.2 B 4.6). */
  bandPosition?: BandPosition;
}
export interface DrivingNativeInput {
  merchantId: string;
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
}
export interface DrivingSequenceInput {
  meetings: DrivingMeetingInput[];
  pastDue: DrivingOwedInput[];
  dueToday: DrivingDueTodayInput[];
  native: DrivingNativeInput[];
  origin: LatLng;
  /** Fixed dwell override for EVERY stop. When omitted, dwell is derived per
   *  kind: 30 min for an appointment/external meeting, 15 min for a flexible
   *  drop-in (`dwellMinutesForKind`). Pass a number only to force one value. */
  dwellMin?: number;
  /** Optional map of dealId -> previous outcome label, for the last-visit line. */
  lastOutcomeByDealId?: Record<string, string>;
}

const MS_PER_MIN = 60_000;

/** Local-tz clock time, e.g. "3:00 PM". Matches reasonLine's own formatter. */
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A stop that still knows its own coords (or lacks them). */
interface Pending {
  card: Omit<DrivingCard, "label" | "reason" | "lastVisit" | "arriveLabel" | "driveMinLabel">;
  label: string;
  reason: string;
  startAt: string | null;
}

export function drivingSequence(
  input: DrivingSequenceInput,
  now: string | number,
): DrivingCard[] {
  // Per-kind dwell (v2.2 B default 3), with an optional flat override. When
  // `dwellMin` is given every stop uses it; otherwise a meeting holds 30 and a
  // flexible drop-in holds 15 via `dwellMinutesForKind`.
  const dwellOverride = input.dwellMin;
  const dwellFor = (kind: string): number =>
    dwellOverride ?? dwellMinutesForKind(kind);
  const lastOutcome = input.lastOutcomeByDealId ?? {};

  // Ordering rule (matches the landing's `drivingSequence` order): weave the
  // day into calendar-time order. Appointments/external meetings are fixed
  // TIME ANCHORS (sorted asc by startAt); the flexible drop-ins (past-due,
  // then due-today, then native nearby, in that order) are routed into the
  // gaps before each anchor via the shared `interleaveAroundAnchors` helper.
  // A flexible stop only lands before an anchor if it plus the drive on to
  // that anchor fits before the anchor's start; leftovers follow the anchors.
  const meetings = [...input.meetings].sort((a, b) =>
    a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0,
  );

  // Each interleave item carries the fully-built Pending so we can recover the
  // card kind/refs/reason after the (possibly reordered) weave.
  type AnchorItem = AnchorLike & { pending: Pending };
  type FlexItem = FlexibleLike & { pending: Pending };

  const anchors: AnchorItem[] = [];
  for (const m of meetings) {
    const pending: Pending = {
      card: {
        id: m.id,
        kind: m.kind,
        name: m.title,
        address: m.address ?? null,
        dealId: m.dealId ?? null,
        appointmentId: m.appointmentId ?? null,
        merchantId: null,
        lat: m.lat ?? null,
        lng: m.lng ?? null,
      },
      label: stopLabel({
        kind: m.kind,
        tier: "appointment",
        startAt: m.startAt,
        ageDays: null,
        datePromisedToday: false,
        hasPriorActivity: true,
      }),
      reason: reasonLine({
        kind: m.kind,
        tier: "appointment",
        startAt: m.startAt,
        ageDays: null,
        datePromisedToday: false,
        hasPriorActivity: true,
        contactName: m.contactName,
      }),
      startAt: m.startAt,
    };
    anchors.push({
      startAt: m.startAt,
      endAt: m.endAt ?? null,
      lat: m.lat ?? null,
      lng: m.lng ?? null,
      pending,
    });
  }

  const flexibleQueue: FlexItem[] = [];

  for (const o of input.pastDue) {
    const pending: Pending = {
      card: {
        id: o.taskId,
        kind: "owed",
        name: o.name,
        address: o.address ?? null,
        dealId: o.dealId,
        appointmentId: null,
        merchantId: null,
        lat: o.lat ?? null,
        lng: o.lng ?? null,
        bandPosition: o.bandPosition,
      },
      label: stopLabel({
        kind: "flexible",
        tier: "past_due",
        startAt: null,
        ageDays: o.ageDays,
        datePromisedToday: o.datePromised ?? false,
        hasPriorActivity: true,
      }),
      reason: reasonLine({
        kind: "flexible",
        tier: "past_due",
        startAt: null,
        ageDays: o.ageDays,
        datePromisedToday: o.datePromised ?? false,
        hasPriorActivity: true,
      }),
      startAt: null,
    };
    flexibleQueue.push({ lat: o.lat ?? 0, lng: o.lng ?? 0, pending });
  }

  for (const d of input.dueToday) {
    const pending: Pending = {
      card: {
        id: d.taskId,
        kind: "owed",
        name: d.name,
        address: d.address ?? null,
        dealId: d.dealId,
        appointmentId: null,
        merchantId: null,
        lat: d.lat ?? null,
        lng: d.lng ?? null,
        bandPosition: d.bandPosition,
      },
      label: stopLabel({
        kind: "flexible",
        tier: "due_today",
        startAt: null,
        ageDays: 0,
        datePromisedToday: d.datePromised ?? false,
        hasPriorActivity: true,
      }),
      reason: reasonLine({
        kind: "flexible",
        tier: "due_today",
        startAt: null,
        ageDays: 0,
        datePromisedToday: d.datePromised ?? false,
        hasPriorActivity: true,
      }),
      startAt: null,
    };
    flexibleQueue.push({ lat: d.lat ?? 0, lng: d.lng ?? 0, pending });
  }

  for (const n of input.native) {
    const pending: Pending = {
      card: {
        id: n.merchantId,
        kind: "nearby",
        name: n.name,
        address: n.address ?? null,
        dealId: null,
        appointmentId: null,
        merchantId: n.merchantId,
        lat: n.lat,
        lng: n.lng,
      },
      label: stopLabel({
        kind: "flexible",
        tier: "nearby",
        startAt: null,
        ageDays: null,
        datePromisedToday: false,
        hasPriorActivity: false,
      }),
      reason: reasonLine({
        kind: "flexible",
        tier: "nearby",
        startAt: null,
        ageDays: null,
        datePromisedToday: false,
        hasPriorActivity: false,
      }),
      startAt: null,
    };
    flexibleQueue.push({ lat: n.lat, lng: n.lng, pending });
  }

  const effectiveStartMs = new Date(now).getTime();
  // The interleave queue is entirely flexible drop-ins, so it holds the flexible
  // dwell (anchors carry their own start/end occupancy inside the helper).
  const interleaved = interleaveAroundAnchors(anchors, flexibleQueue, {
    origin: input.origin,
    dwellMin: dwellFor("flexible"),
    effectiveStartMs,
  });
  const ordered: Pending[] = interleaved.map((x) => x.item.pending);

  // Walk the interleaved order, threading a running clock and a location
  // cursor. Semantics per card are unchanged; only the ORDER changed.
  let clockMs = effectiveStartMs;
  let cursor: LatLng = input.origin;

  const out: DrivingCard[] = [];
  for (const p of ordered) {
    const hasCoords = p.card.lat != null && p.card.lng != null;

    let driveMin = 0;
    if (hasCoords) {
      const point: LatLng = { lat: p.card.lat!, lng: p.card.lng! };
      driveMin = driveMinutesBetween(cursor, point);
      cursor = point;
    }
    // A card with no coords keeps the previous cursor and a 0-minute leg.

    clockMs += driveMin * MS_PER_MIN;

    const rounded = Math.round(driveMin);
    const driveMinLabel =
      rounded === 0 && driveMin > 0 ? "1 min" : `${rounded} min`;

    const isMeeting = p.card.kind === "appointment" || p.card.kind === "external";
    const arriveLabel =
      isMeeting && p.startAt
        ? fmtClock(new Date(p.startAt).getTime())
        : `around ${fmtClock(clockMs)}`;

    const lastVisit = p.card.dealId
      ? lastVisitContext(lastOutcome[p.card.dealId] ?? null)
      : null;

    out.push({
      ...p.card,
      label: p.label,
      reason: p.reason,
      lastVisit,
      arriveLabel,
      driveMinLabel,
    });

    // Dwell after visiting advances the clock for the next card, per kind.
    clockMs += dwellFor(p.card.kind) * MS_PER_MIN;
  }

  return out;
}
