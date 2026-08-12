import type { StopKind, StopTier } from "./todaysPath";

/** The minimal fields the label + reason line need, decoupled from OrderedStop
 *  so it's easy to feed from any surface. */
export interface ReasonStop {
  kind: StopKind;
  tier: StopTier;
  /** Appointment start (ISO); null for flexible stops. */
  startAt: string | null;
  /** Past-due staleness in days; null when not applicable. */
  ageDays: number | null;
  /** True when the follow-up is an asserted promise (date_source asserted). */
  datePromisedToday: boolean;
  /** True when the deal already has activity (distinguishes discovered/new). */
  hasPriorActivity: boolean;
  /** Appointment contact name for the detail sentence (v2.2 B 4.5.1). When
   *  absent/empty the appointment sentence is empty (the rail carries the time). */
  contactName?: string | null;
}

/** The left-rail category label (v2.2 B 4.5). The label carries the category;
 *  the sentence beside it never repeats the category word. */
export type StopLabel = "appointment" | "you promised" | "anytime" | "on the way";

/**
 * v2.2 B 4.5. The left-rail label for a stop, one per row:
 *  - "appointment": a booked calendar event (tier "appointment").
 *  - "you promised": a visit asserted for a date by the rep/merchant.
 *  - "on the way": a discovery fill (tier "nearby", no prior activity).
 *  - "anytime": a drop-in inside its band, no time constraint (owed / due-today).
 */
export function stopLabel(stop: ReasonStop): StopLabel {
  if (stop.tier === "appointment") return "appointment";
  if (stop.datePromisedToday) return "you promised";
  if (stop.tier === "nearby" && !stop.hasPriorActivity) return "on the way";
  return "anytime";
}

/**
 * v2.2 B 4.5.1. The sentence beside the label: the DETAIL only, never the
 * category word. May be empty (an appointment with no contact).
 *  - appointment: the CONTACT name if there is one, otherwise empty (the rail
 *    carries the time).
 *  - you promised: "The owner is expecting you."
 *  - anytime: "{N} days since your last stop." (singular "1 day since ...").
 *  - on the way: "Nobody's been in yet."
 */
export function reasonLine(stop: ReasonStop): string {
  if (stop.tier === "appointment") {
    // The rail carries the time; the sentence names the contact if there is one.
    // TODO(4.5.1): contact name is not plumbed on every surface yet; render empty
    // rather than inventing one. The row must not collapse when this is empty.
    return stop.contactName ?? "";
  }
  if (stop.datePromisedToday) {
    return "The owner is expecting you.";
  }
  if (stop.tier === "nearby" && !stop.hasPriorActivity) {
    return "Nobody's been in yet.";
  }
  const n = stop.ageDays ?? 0;
  return `${n} ${n === 1 ? "day" : "days"} since your last stop.`;
}

/** Driving-screen context line (spec 6.1 last row). Null when no prior outcome. */
export function lastVisitContext(previousOutcomeLabel: string | null): string | null {
  if (!previousOutcomeLabel) return null;
  return `Last time, ${previousOutcomeLabel.toLowerCase()}.`;
}
