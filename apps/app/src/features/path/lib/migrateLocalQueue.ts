/**
 * planQueueMigration — pure planner for the one-time local-queue → server-path
 * migration. The local queue stores only merchant ids; path_stops needs the
 * display snapshot, so we resolve each id against the currently-loaded merchants
 * (from useMerchants). Stops whose merchant isn't loaded are reported as
 * `unresolved` and skipped (best-effort: the local queue is ephemeral
 * today-only data, and the rep is normally near the queued businesses on first
 * v3 load). The caller (PathPage) feeds these snapshots into addStops.
 *
 * Note: Merchant has no primaryType field (that comes from Google Places in
 * Phase 2). The snapshot's primaryType is always null for locally-queued stops.
 */
import type { Merchant } from "../mockData";
import type { StopSnapshot } from "../hooks/usePathMutations";

/** Minimal shape we read from a persisted usePathQueue stop. */
export interface LocalStop {
  merchantId: string;
}

export interface QueueMigrationPlan {
  snapshots: StopSnapshot[];
  unresolved: string[];
}

export function planQueueMigration(
  localStops: LocalStop[],
  merchantsById: Map<string, Merchant>,
): QueueMigrationPlan {
  const snapshots: StopSnapshot[] = [];
  const unresolved: string[] = [];
  for (const stop of localStops) {
    const m = merchantsById.get(stop.merchantId);
    if (!m) {
      unresolved.push(stop.merchantId);
      continue;
    }
    snapshots.push({
      prospectId: m.id,
      name: m.name,
      address: m.address,
      lat: m.lat,
      lng: m.lng,
      category: m.category,
      primaryType: null, // Merchant has no primaryType; populated by Places in Phase 2
      phone: m.phone ?? null,
    });
  }
  return { snapshots, unresolved };
}
