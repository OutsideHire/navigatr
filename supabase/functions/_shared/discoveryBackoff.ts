/**
 * discoveryBackoff: shared, pure helpers for discover_prospects' rate-limit
 * circuit breaker.
 *
 * Context: a cold "plan a new area" fans out to MAX_CELLS geo cells x ~13
 * industry buckets = up to ~1,700 Google Places `searchNearby` calls. If the
 * project's Places quota is exhausted, Google returns HTTP 429 on all of them,
 * and (before this) the fan-out fired every one anyway, then the client retried,
 * keeping the quota pinned. That storm is what took Path discovery down in prod
 * (2026-09-10).
 *
 * The circuit breaker: as soon as ONE Google call comes back 429, we trip a
 * request-scoped gate. Any not-yet-started call in the fan-out short-circuits
 * (returns nothing) instead of hitting an already-exhausted quota, and the
 * handler returns a distinct 429 so the client backs off instead of retrying.
 * This caps a jammed request from ~1,700 calls down to whatever was already in
 * flight (a couple dozen), and lets the quota recover.
 */

/** Google Places (New) signals quota exhaustion / rate limiting with HTTP 429
 *  (RESOURCE_EXHAUSTED). This is the ONLY status that trips the breaker; a 400
 *  (bad request) or 5xx (transient) is a per-bucket failure, not a project-wide
 *  quota wall, so those must NOT short-circuit the whole fan-out. */
export function isRateLimitStatus(status: number): boolean {
  return status === 429;
}

/** Request-scoped circuit breaker. One per discovery request; never shared
 *  across requests (edge workers are reused, so a leaked gate would wrongly
 *  short-circuit the next caller). */
export interface RateGate {
  tripped: boolean;
}

export function newRateGate(): RateGate {
  return { tripped: false };
}

/** Record a Google response status against the gate. Returns true once the gate
 *  is tripped (this call or a prior one) so the caller can stop fanning out. */
export function noteStatus(gate: RateGate, status: number): boolean {
  if (isRateLimitStatus(status)) gate.tripped = true;
  return gate.tripped;
}

export type ColdFetchOutcome = "ok" | "rate_limited" | "fetch_failed";

/**
 * Decide the response for a cold fan-out.
 *   - got at least one pull            -> "ok" (proceed with what we have)
 *   - zero pulls, breaker was tripped  -> "rate_limited" (return 429; client backs off)
 *   - zero pulls, no rate limit        -> "fetch_failed" (return 502; the prior behavior)
 * Partial success (some pulls) proceeds even if the breaker tripped: we keep the
 * results we got, and the breaker already stopped the rest of the storm.
 */
export function classifyColdFetch(totalPulls: number, rateLimited: boolean): ColdFetchOutcome {
  if (totalPulls > 0) return "ok";
  return rateLimited ? "rate_limited" : "fetch_failed";
}
