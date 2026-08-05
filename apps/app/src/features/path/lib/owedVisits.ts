/**
 * Owed visits (SP3 T3) — assemble the drop-in follow-ups a rep owes into
 * routable candidates. Pure: takes the three row sets the hook fetches (open
 * drop-in tasks, their deals, and the prospects that supply coordinates) and
 * joins them in memory. Coordinates come from the deal's originating prospect
 * matched on Google `place_id` (SP3 decision: free, no geocoding). A deal with
 * no place_id, or whose prospect isn't in the cache, has no coords and is not
 * routable in v1.
 *
 * The urgency + band come from the SP1 band dates via the Class D helpers; Path
 * never recomputes them.
 */

import { bandPosition, isClassDEligible, urgencyFor, type BandPosition, type ClassDTaskLike } from "./classD";

/** One open drop-in task, as the hook reads it from `task`. */
export interface OwedTaskRow {
  id: string;
  deal_id: string | null;
  type: string;
  status: string;
  earliest_at: string;
  target_at: string;
  latest_at: string;
  date_source: string;
  exclude_from_path: boolean;
  source_outcome: string | null;
  /** UTC ISO. Used for the same-day exclusion: a follow-up created during today's
   *  path (an outcome logged mid-run) isn't pulled back into today. */
  created_at: string;
}

/** Optional guards applied on top of Class D eligibility. */
export interface OwedVisitOptions {
  /** Deals with a scheduled appointment on the Path date — the appointment
   *  supersedes the drop-in (spec §7), so its owed visit is suppressed. */
  supersededDealIds?: Set<string>;
  /** UTC ISO of the Path date's local midnight. Tasks created at or after this
   *  (i.e. created today) are excluded so the owed list doesn't churn as the rep
   *  logs outcomes during the run. */
  excludeCreatedAtOrAfter?: string;
}

/** The deal fields the join needs: stage (won/lost are ineligible) + place_id
 *  (the coordinate key) + display name/address. */
export interface OwedDealRow {
  id: string;
  company_name: string;
  address: string | null;
  stage: string;
  place_id: string | null;
}

/** A prospect row supplying coordinates for a place_id. */
export interface OwedProspectRow {
  place_id: string;
  lat: number;
  lng: number;
}

/** A routable owed visit: a due drop-in with real coordinates + urgency. */
export interface OwedVisit {
  taskId: string;
  dealId: string;
  name: string;
  address: string | null;
  placeId: string;
  lat: number;
  lng: number;
  urgency: number;
  bandPosition: BandPosition;
  dateSource: string;
  targetAt: string;
  /** The outcome that generated this follow-up (for the "from <outcome>" chip). */
  sourceOutcome: string | null;
}

/**
 * Join tasks → deals (by deal_id) → prospects (by place_id) and keep only the
 * Class D eligible ones for `pathDate`, ordered by descending urgency (aging +
 * pinned first), then by earliest target date as a stable tiebreak.
 */
export function assembleOwedVisits(
  tasks: OwedTaskRow[],
  deals: OwedDealRow[],
  prospects: OwedProspectRow[],
  pathDate: string,
  opts: OwedVisitOptions = {},
): OwedVisit[] {
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const coordsByPlaceId = new Map(prospects.map((p) => [p.place_id, p]));
  const superseded = opts.supersededDealIds;
  const createdCutoff = opts.excludeCreatedAtOrAfter;

  const visits: OwedVisit[] = [];
  for (const t of tasks) {
    if (t.deal_id == null) continue;
    // Created during today's path (an outcome logged mid-run) → not pulled back in.
    if (createdCutoff && t.created_at >= createdCutoff) continue;
    const deal = dealById.get(t.deal_id);
    if (!deal) continue;
    // A scheduled appointment on this deal today supersedes the drop-in.
    if (superseded?.has(deal.id)) continue;
    const coords = deal.place_id ? coordsByPlaceId.get(deal.place_id) : undefined;
    const hasCoords = coords != null;

    const eligible = isClassDEligible(
      {
        type: t.type,
        status: t.status,
        earliestAt: t.earliest_at,
        excludeFromPath: t.exclude_from_path,
        dealStage: deal.stage,
        hasCoords,
      },
      pathDate,
    );
    if (!eligible || !coords || !deal.place_id) continue;

    const taskLike: ClassDTaskLike = {
      type: t.type,
      status: t.status,
      earliestAt: t.earliest_at,
      targetAt: t.target_at,
      latestAt: t.latest_at,
      dateSource: t.date_source,
      excludeFromPath: t.exclude_from_path,
    };
    visits.push({
      taskId: t.id,
      dealId: deal.id,
      name: deal.company_name,
      address: deal.address,
      placeId: deal.place_id,
      lat: coords.lat,
      lng: coords.lng,
      urgency: urgencyFor(taskLike, pathDate),
      bandPosition: bandPosition(taskLike, pathDate),
      dateSource: t.date_source,
      targetAt: t.target_at,
      sourceOutcome: t.source_outcome,
    });
  }

  visits.sort((a, b) => b.urgency - a.urgency || a.targetAt.localeCompare(b.targetAt));
  return visits;
}
