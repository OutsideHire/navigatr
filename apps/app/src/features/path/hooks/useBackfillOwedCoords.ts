/**
 * useBackfillOwedCoords (Path QA B2-ii) — lazily geocode the owed / due-today
 * drop-in deals that surfaced in the "No location yet" group BUT carry a street
 * address. Each such deal is geocoded once and its lat/lng stamped (via
 * useGeocodeDealCoords), which invalidates the owed / due-today bands so the
 * deal re-reads as routable and leaves the no-location group.
 *
 * Rate-safety: exactly ONE attempt per dealId per session. The dealId is added
 * to a seen-set BEFORE the geocode fires, so a miss or failure never re-loops;
 * the deal simply stays no-location. The geocode itself is best-effort (a
 * failure is swallowed inside useGeocodeDealCoords). Two owed tasks on the same
 * deal collapse to a single attempt (keyed by dealId, not taskId).
 *
 * Callers should pass ONLY stubs that carry an address; the hook re-checks the
 * address defensively so a caller that forgets the filter still cannot fire an
 * empty-query geocode.
 */
import * as React from "react";
import { useGeocodeDealCoords } from "@/features/pipeline/hooks/useGeocodeDealCoords";
import type { OwedVisitNoCoords } from "../lib/owedVisits";

export function useBackfillOwedCoords(stubs: OwedVisitNoCoords[]): void {
  const geocode = useGeocodeDealCoords();
  // Stable across renders so a fresh mutation-object identity never re-triggers
  // the effect; the effect keys only on the stubs it is given.
  const mutateRef = React.useRef(geocode.mutate);
  mutateRef.current = geocode.mutate;
  const seenRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    for (const stub of stubs) {
      if (!stub.address || !stub.address.trim()) continue;
      if (seenRef.current.has(stub.dealId)) continue;
      // Mark BEFORE firing: one attempt per dealId per session regardless of
      // whether this geocode resolves, so we never loop on a persistent miss.
      seenRef.current.add(stub.dealId);
      mutateRef.current({ dealId: stub.dealId });
    }
  }, [stubs]);
}
