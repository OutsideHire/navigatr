import type { StopKind, StopTier } from "./todaysPath";

/** The minimal fields the reason line needs, decoupled from OrderedStop so it's
 *  easy to feed from any surface. */
export interface ReasonStop {
  kind: StopKind;
  tier: StopTier;
  /** Appointment start (ISO); null for flexible stops. */
  startAt: string | null;
  /** Past-due staleness in days; null when not applicable. */
  ageDays: number | null;
  /** True when the follow-up is an asserted promise landing today. */
  datePromisedToday: boolean;
  /** True when the deal already has activity (distinguishes discovered/new). */
  hasPriorActivity: boolean;
}

/** Local-tz clock time, e.g. "3:00 PM". */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** FR-PATH-UX-05 / spec 6.1. Exactly one plain sentence per stop. */
export function reasonLine(stop: ReasonStop): string {
  if (stop.tier === "appointment" && stop.startAt) {
    return `You have a ${fmtTime(stop.startAt)} here.`;
  }
  if (stop.datePromisedToday) {
    return "You told the owner you would come back today.";
  }
  if (stop.tier === "nearby" && !stop.hasPriorActivity) {
    return "New. Nobody has been in.";
  }
  const n = stop.ageDays ?? 0;
  return `You have not stopped by in ${n} ${n === 1 ? "day" : "days"}.`;
}

/** Driving-screen context line (spec 6.1 last row). Null when no prior outcome. */
export function lastVisitContext(previousOutcomeLabel: string | null): string | null {
  if (!previousOutcomeLabel) return null;
  return `Last time, ${previousOutcomeLabel.toLowerCase()}.`;
}
