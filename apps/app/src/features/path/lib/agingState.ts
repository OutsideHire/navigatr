/**
 * agingState. The SINGLE source for the three aging states (Robert Path v2.2,
 * Ticket B 4.6 + Section 3.1). Color on a Path row / pin encodes AGING ONLY, and
 * that aging is DERIVED FROM THE FOLLOW-UP'S BAND, never from a hardcoded day
 * count:
 *   - neutral: before the target date (in its window / not yet due).
 *   - warm:    past the target date (past_ideal).
 *   - hot:     past the latest acceptable date (aging).
 *
 * The band position comes from the SP1 band dates via `bandPosition` (lib/classD
 * / OwedVisit); Path never recomputes it and never thresholds on `ageDays`. Any
 * non-aging band (in_window, not_yet_open, the asserted/sla "pinned" band) and an
 * unknown/undefined band read as neutral: a pin/promise is not an aging signal.
 */

import type { BandPosition } from "./classD";

/** The three aging states (Section 3.1, warm range). */
export type AgingState = "neutral" | "warm" | "hot";

/**
 * The aging state for a band position. This is the ONLY place the band -> state
 * mapping lives, so every surface (list rows, landing rows, map pins, driving
 * card) colors aging identically and no day-count threshold is duplicated.
 */
export function agingStateFromBand(band: BandPosition | undefined): AgingState {
  switch (band) {
    case "past_ideal":
      return "warm";
    case "aging":
      return "hot";
    default:
      // in_window, not_yet_open, pinned (asserted/sla), or unknown/undefined.
      return "neutral";
  }
}

/** The reason-line text-color token for an aging state (design tokens): neutral
 *  -> muted, warm -> the warning token, hot -> the distinct danger token. Shared
 *  so the list + landing rows never re-declare the mapping. */
export function agingReasonTextClass(state: AgingState): string {
  switch (state) {
    case "hot":
      return "text-status-danger";
    case "warm":
      return "text-status-warning";
    default:
      return "text-text-muted";
  }
}
