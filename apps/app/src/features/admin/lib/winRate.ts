/**
 * Win-rate display with a minimum closed-deal floor (PRD 6.12.A FR-HIER-30).
 *
 * A rep with three wins and no losses is not a 100%-win-rate rep, they are a
 * rep with too few closed deals to have a meaningful rate. Below the floor we
 * show a dash instead of a misleading percentage. "Closed" = won + lost.
 */

/** Minimum closed deals (won + lost) before a win rate is shown. */
export const WIN_RATE_MIN_CLOSED = 5;

/** Numeric win ratio for sorting: won / (won + lost). Returns -1 when there are
 *  no closed deals so those rows sort to the bottom. Not floored, so sort order
 *  is stable even for low-volume reps (their cell still renders a dash). */
export function winRatio(wonDeals: number, lostDeals: number): number {
  const closed = wonDeals + lostDeals;
  return closed === 0 ? -1 : wonDeals / closed;
}

/** Display string: a whole-percent win rate, or "—" below the volume floor. */
export function formatWinRate(wonDeals: number, lostDeals: number): string {
  const closed = wonDeals + lostDeals;
  if (closed < WIN_RATE_MIN_CLOSED) return "—";
  return `${Math.round((wonDeals / closed) * 100)}%`;
}

/** True when a win rate is shown (at/above the floor) — drives the dimmed
 *  styling on the cell. */
export function hasWinRate(wonDeals: number, lostDeals: number): boolean {
  return wonDeals + lostDeals >= WIN_RATE_MIN_CLOSED;
}
