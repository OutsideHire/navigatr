import type { LatLng } from "@/lib/distance";
import { driveMinutesBetween } from "./driveTime";
import { reasonLine, lastVisitContext } from "./reasonLine";

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
  /** One plain reason sentence (spec 6.1), via reasonLine. */
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
}

export interface DrivingMeetingInput {
  id: string;
  kind: "appointment" | "external";
  title: string;
  address?: string | null;
  dealId?: string | null;
  appointmentId?: string | null;
  startAt: string; // ISO
  lat?: number | null;
  lng?: number | null;
}
export interface DrivingOwedInput {
  taskId: string;
  dealId: string;
  name: string;
  address?: string | null;
  ageDays: number;
  lat?: number | null;
  lng?: number | null;
}
export interface DrivingDueTodayInput {
  taskId: string;
  dealId: string;
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
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
  /** Minutes spent at each stop. Default 20. */
  dwellMin?: number;
  /** Optional map of dealId -> previous outcome label, for the last-visit line. */
  lastOutcomeByDealId?: Record<string, string>;
}

const DEFAULT_DWELL_MIN = 20;
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
  card: Omit<DrivingCard, "reason" | "lastVisit" | "arriveLabel" | "driveMinLabel">;
  reason: string;
  startAt: string | null;
}

export function drivingSequence(
  input: DrivingSequenceInput,
  now: string | number,
): DrivingCard[] {
  const dwellMin = input.dwellMin ?? DEFAULT_DWELL_MIN;
  const lastOutcome = input.lastOutcomeByDealId ?? {};

  // Ordering rule (matches ActivePathView's [...liveRows, ...nativeRows]):
  // meetings first sorted by startAt asc, then past-due (given order),
  // then due-today (given order), then native nearby (given order).
  const meetings = [...input.meetings].sort((a, b) =>
    a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0,
  );

  const pending: Pending[] = [];

  for (const m of meetings) {
    pending.push({
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
      reason: reasonLine({
        kind: m.kind,
        tier: "appointment",
        startAt: m.startAt,
        ageDays: null,
        datePromisedToday: false,
        hasPriorActivity: true,
      }),
      startAt: m.startAt,
    });
  }

  for (const o of input.pastDue) {
    pending.push({
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
      },
      reason: reasonLine({
        kind: "flexible",
        tier: "past_due",
        startAt: null,
        ageDays: o.ageDays,
        datePromisedToday: false,
        hasPriorActivity: true,
      }),
      startAt: null,
    });
  }

  for (const d of input.dueToday) {
    pending.push({
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
      },
      reason: reasonLine({
        kind: "flexible",
        tier: "due_today",
        startAt: null,
        ageDays: 0,
        datePromisedToday: false,
        hasPriorActivity: true,
      }),
      startAt: null,
    });
  }

  for (const n of input.native) {
    pending.push({
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
      reason: reasonLine({
        kind: "flexible",
        tier: "nearby",
        startAt: null,
        ageDays: null,
        datePromisedToday: false,
        hasPriorActivity: false,
      }),
      startAt: null,
    });
  }

  // Walk the ordered cards, threading a running clock and a location cursor.
  let clockMs = new Date(now).getTime();
  let cursor: LatLng = input.origin;

  const out: DrivingCard[] = [];
  for (const p of pending) {
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
      reason: p.reason,
      lastVisit,
      arriveLabel,
      driveMinLabel,
    });

    // Dwell after visiting advances the clock for the next card.
    clockMs += dwellMin * MS_PER_MIN;
  }

  return out;
}
