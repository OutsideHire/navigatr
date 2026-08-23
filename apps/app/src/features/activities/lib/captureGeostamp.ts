/**
 * Activity geostamp capture (PRD 6.12.A Bundle 5, FR-HIER-33/34/35).
 *
 * Called once, at the moment a rep logs an activity. It is BEST-EFFORT and must
 * never block or fail the activity save (FR-HIER-34) — the caller fires it
 * without awaiting and it swallows every error. It captures position only at
 * this instant (no watching / polling, FR-HIER-35), and it writes a row even on
 * failure so the capture-health figure can see denials/timeouts (FR-HIER-33).
 *
 * Consent (FR-HIER-32): skipped entirely when the rep has turned the
 * "geostamp on my activities" setting off. A missing settings row means ON.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Mirrors the activity_locations.capture_status check constraint. */
export type CaptureStatus =
  | "captured"
  | "permission_denied"
  | "timed_out"
  | "unavailable"
  | "unsupported";

export interface CaptureResult {
  status: CaptureStatus;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
}

const CAPTURE_TIMEOUT_MS = 10_000;

/** Resolve the device position once, mapping every outcome to a CaptureStatus.
 *  Never rejects. Exported for testing. */
export function readPositionOnce(): Promise<CaptureResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ status: "unsupported", latitude: null, longitude: null, accuracyM: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          status: "captured",
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        }),
      (err) =>
        resolve({
          // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
          status: err.code === 1 ? "permission_denied" : err.code === 3 ? "timed_out" : "unavailable",
          latitude: null,
          longitude: null,
          accuracyM: null,
        }),
      { enableHighAccuracy: false, timeout: CAPTURE_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

/** True unless the rep has explicitly opted out. Missing row => enabled. */
export async function isGeostampEnabled(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_location_settings")
    .select("activity_geostamp_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return true; // fail open to the PRD default (ON) on a read hiccup
  return data?.activity_geostamp_enabled ?? true;
}

export interface GeostampArgs {
  supabase: SupabaseClient;
  userId: string;
  orgId: string;
  activityId: string;
  dealId: string | null;
}

/**
 * Capture + store a geostamp for a just-logged activity. Fire-and-forget: the
 * caller does not await this, and it never throws. Skips silently when consent
 * is off; otherwise writes exactly one row reflecting the capture outcome.
 */
export async function captureAndStoreGeostamp(args: GeostampArgs): Promise<void> {
  const { supabase, userId, orgId, activityId, dealId } = args;
  try {
    if (!(await isGeostampEnabled(supabase, userId))) return;
    const result = await readPositionOnce();
    await supabase.from("activity_locations").insert({
      activity_id: activityId,
      org_id: orgId,
      deal_id: dealId,
      captured_at: new Date().toISOString(),
      latitude: result.latitude,
      longitude: result.longitude,
      accuracy_m: result.accuracyM,
      capture_status: result.status,
    });
  } catch {
    // Best-effort telemetry: a geostamp failure must never surface to the rep
    // or affect the logged activity (FR-HIER-34).
  }
}
