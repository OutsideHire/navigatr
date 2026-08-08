/**
 * useCreateDeal — INSERT a new deal via Supabase.
 *
 * Input is the camelCase Deal shape the form already builds. We translate
 * to snake_case + extract org_id from the user's profile (the RLS
 * with-check ALSO enforces this; sending the wrong org_id would 403).
 *
 * Profession-specific fields (annualVolume, acceptanceMethods, etc.) live
 * under `profession_data` JSONB — the form already groups them, so the
 * caller just passes an object.
 *
 * On success: invalidate the deals list so the new row appears.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { useFollowupSync } from "@/features/appointments/useFollowupSync";
import { DEALS_QUERY_KEY } from "./useDeals";
import type { DealStage } from "../mockData";

/**
 * Thrown by useCreateDeal when the deals_org_place_active_uidx partial unique
 * index rejects the insert, i.e. an ACTIVE deal for this place_id already exists
 * in the org. Callers catch this to show a friendly de-dupe message instead of a
 * raw database error.
 */
export class DuplicateDealError extends Error {
  constructor() {
    super("This business is already in your team's pipeline.");
    this.name = "DuplicateDealError";
  }
}

/** Name of the partial unique index that enforces one active deal per
 *  (org_id, place_id). Postgres embeds it in the 23505 error message. */
const ACTIVE_PLACE_ID_CONSTRAINT = "deals_org_place_active_uidx";

/** Token the enforce_active_deal_dedupe trigger embeds in its 23505 message
 *  when a name+address key collides with another active deal (the second
 *  de-dup identity key, migration 20260804000002). */
const ACTIVE_DEDUPE_TOKEN = "deals_active_dedupe";

/** True only when a Postgres error is the active-deal place_id uniqueness
 *  violation, as opposed to any other 23505 (e.g. a source-system dedupe). */
export function isDuplicatePlaceDealError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return error?.code === "23505" && (error.message ?? "").includes(ACTIVE_PLACE_ID_CONSTRAINT);
}

/** True for EITHER active-deal de-dup guard: the place_id unique index OR the
 *  name+address trigger. Both map to the same calm DuplicateDealError. */
export function isDuplicateActiveDealError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (error?.code !== "23505") return false;
  const msg = error.message ?? "";
  return msg.includes(ACTIVE_PLACE_ID_CONSTRAINT) || msg.includes(ACTIVE_DEDUPE_TOKEN);
}

export interface CreateDealInput {
  companyName: string;
  address?: string;
  industry?: string;
  employeeCountRange?: string;
  contactName: string;
  contactTitle?: string;
  contactEmail?: string;
  contactPhone: string;
  valueCents?: number;
  stage: DealStage;
  probability: number;
  expectedClose?: string | null;     // ISO date
  leadSource?: string;
  /** Required free-text note when leadSource is "other" (LS-1). */
  leadSourceNote?: string | null;
  /** Originating Path id for Path-stamped deals (LS-1). */
  sourcePathId?: string | null;
  notes?: string;
  nextFollowupAt?: string | null;    // ISO timestamp
  professionData?: Record<string, unknown>;
  /** Google place_id of the source prospect. Present for deals created from Path
   *  discovery; null for manually-entered deals. Anchors org-wide de-duplication. */
  placeId?: string;
  /** Coordinates, if already known (Path-created deals). When absent on a manual
   *  deal with an address, we geocode the address at create time (P2.1). */
  lat?: number | null;
  lng?: number | null;
  /** Sibling link to the first record of a multi-location merchant, set when the
   *  rep confirms a Business-Search result is a second location (Add-Deal slice D). */
  parentDealId?: string | null;
  /** When the cached Google Places fields were resolved (ISO). Stamped only for
   *  Business-Search creates so the permitted refresh cycle has an anchor. */
  placeSyncedAt?: string | null;
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const { syncFollowup } = useFollowupSync();

  return useMutation({
    mutationFn: async (input: CreateDealInput): Promise<{ id: string }> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) throw new Error("Profile not loaded — cannot create deal");

      // Geocode a manual deal's address so it can be routed as an owed visit.
      // Best-effort: a geocode miss or failure never blocks deal creation — the
      // deal is simply not routable until an address that resolves is saved.
      let lat = input.lat ?? null;
      let lng = input.lng ?? null;
      if (lat == null && lng == null && input.address && !input.placeId) {
        try {
          const { data: geo } = await supabase.functions.invoke<{ result?: { lat: number; lng: number } }>(
            "geocode",
            { body: { query: input.address } },
          );
          if (geo?.result) {
            lat = geo.result.lat;
            lng = geo.result.lng;
          }
        } catch {
          // swallow — coordinates are optional
        }
      }

      const { data, error } = await supabase
        .from("deals")
        .insert({
          org_id:              profile.data.org_id,
          owner_id:            userId,
          company_name:        input.companyName,
          address:             input.address ?? null,
          industry:            input.industry ?? null,
          employee_count_range: input.employeeCountRange ?? null,
          contact_name:        input.contactName,
          contact_title:       input.contactTitle ?? null,
          contact_email:       input.contactEmail ?? null,
          contact_phone:       input.contactPhone,
          value_cents:         input.valueCents ?? null,
          stage:               input.stage,
          probability:         input.probability,
          expected_close:      input.expectedClose ?? null,
          lead_source:         input.leadSource ?? "unknown",
          lead_source_note:    input.leadSourceNote ?? null,
          source_path_id:      input.sourcePathId ?? null,
          notes:               input.notes ?? null,
          next_followup_at:    input.nextFollowupAt ?? null,
          profession_data:     input.professionData ?? {},
          place_id:            input.placeId ?? null,
          parent_deal_id:      input.parentDealId ?? null,
          place_synced_at:     input.placeSyncedAt ?? null,
          lat,
          lng,
        })
        .select("id")
        .single();
      if (error) {
        // Either active-deal de-dup guard (place_id index or name+address
        // trigger) maps to the calm "already in your team's pipeline" story. Any
        // other unique violation or error is rethrown unchanged so it is not
        // mislabeled.
        if (isDuplicateActiveDealError(error)) {
          throw new DuplicateDealError();
        }
        throw error;
      }
      return { id: data.id as string };
    },
    onSuccess: (data, variables) => {
      // Trigger refetch of the list so the new deal appears.
      void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
      // If the deal was created with a follow-up date, reconcile it to an
      // all-day calendar event right away — nothing else fires sync on the
      // create path. Only when a follow-up was actually set. Fire-and-forget.
      if (variables.nextFollowupAt) {
        void syncFollowup(data.id);
      }
    },
  });
}
