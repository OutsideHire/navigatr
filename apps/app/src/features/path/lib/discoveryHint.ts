/**
 * discoveryHint — builds the one-line explanation shown under Path discovery
 * results when the count is short of what the rep asked for, or when auto-widen
 * had to grow the search radius to fill it.
 *
 * Pure + tested so the exact phrasing/omission rules live in one place and the
 * page components just render the string (or nothing).
 *
 * Rules:
 *   - No shortfall and no widening -> null (nothing to explain; stay quiet).
 *   - Shortfall -> "Showing N of M requested".
 *   - Widened   -> "widened to X mi".
 *   - Shortfall + something hidden nearby -> "P chains and Q already in your
 *     pipeline were hidden nearby" (zero parts omitted).
 * Clauses are joined with " · ".
 */

export interface DiscoveryHintInput {
  /** Businesses actually shown (merchants.length). */
  shown: number;
  /** Results count the rep requested. */
  requested: number;
  /** Radius originally requested, meters. */
  requestedRadiusM: number;
  /** Radius the shown set actually came from, meters (>= requested if widened). */
  effectiveRadiusM: number;
  /** Nearby businesses hidden from the shown set. */
  hidden: { chains: number; inPipeline: number };
}

const METERS_PER_MILE = 1609.34;

function toMiles(m: number): number {
  return Math.max(1, Math.round(m / METERS_PER_MILE));
}

/** "3 chains and 2 already in your pipeline were hidden nearby", omitting any
 *  zero part. Returns null when nothing was hidden. */
function hiddenClause(chains: number, inPipeline: number): string | null {
  const parts: string[] = [];
  if (chains > 0) parts.push(`${chains} ${chains === 1 ? "chain" : "chains"}`);
  if (inPipeline > 0) parts.push(`${inPipeline} already in your pipeline`);
  if (parts.length === 0) return null;
  const total = chains + inPipeline;
  return `${parts.join(" and ")} ${total === 1 ? "was" : "were"} hidden nearby`;
}

export function discoveryShortfallHint(input: DiscoveryHintInput): string | null {
  const shortfall = input.shown < input.requested;
  const widened = input.effectiveRadiusM > input.requestedRadiusM;

  // Filled at the requested radius with no widening: nothing to explain.
  if (!shortfall && !widened) return null;

  const clauses: string[] = [];
  if (shortfall) clauses.push(`Showing ${input.shown} of ${input.requested} requested`);
  if (widened) clauses.push(`widened to ${toMiles(input.effectiveRadiusM)} mi`);
  if (shortfall) {
    const hidden = hiddenClause(input.hidden.chains, input.hidden.inPipeline);
    if (hidden) clauses.push(hidden);
  }

  return clauses.length > 0 ? clauses.join(" · ") : null;
}
