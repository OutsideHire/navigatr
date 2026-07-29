/**
 * Pure matching for SP0 call-coverage: which click-to-call dials were never
 * logged as a Call activity within the grace window. Runs on read (no job).
 * navigatr's activities.disposition is NOT NULL, so the existence of a
 * type='call' activity for the deal IS the "logged" marker.
 */

/** PRD §3.3.C.4 call-grace window. A dial younger than this is "pending". */
export const CALL_GRACE_MS = 4 * 60 * 60 * 1000;

export interface DialSignal {
  dealId: string;
  /** ISO timestamp of the tap. */
  detectedAt: string;
  /**
   * Explicit link stamped by the match_unlogged_dials RPC when the rep logs
   * an outcome from the nudge, however long after the dial. Non-null means
   * logged, independent of the 4h auto-match window below (that window only
   * covers same-session logs).
   */
  matchedActivityId?: string | null;
}

export interface CallActivity {
  dealId: string;
  /** ISO timestamp the call occurred. */
  occurredAt: string;
}

export interface UnloggedDial {
  dealId: string;
  /** Most recent unlogged dial to this deal (ISO). */
  lastDetectedAt: string;
  /** How many unlogged dials to this deal. */
  dialCount: number;
}

export function computeUnloggedDials(
  dials: DialSignal[],
  callActivities: CallActivity[],
  now: Date,
): UnloggedDial[] {
  const nowMs = now.getTime();

  const unlogged = dials.filter((d) => {
    const detectedMs = new Date(d.detectedAt).getTime();
    // Still within the grace window — the rep may yet log it.
    if (nowMs - detectedMs < CALL_GRACE_MS) return false;
    // Logged when the RPC has stamped an explicit match (any lag, e.g. a
    // next-day log), OR (fast path) a Call activity exists for the deal
    // within [dial, dial+4h] (same-session logs auto-clear without needing
    // the explicit stamp).
    if (d.matchedActivityId != null) return false;
    const matched = callActivities.some((a) => {
      if (a.dealId !== d.dealId) return false;
      const occurredMs = new Date(a.occurredAt).getTime();
      return occurredMs >= detectedMs && occurredMs <= detectedMs + CALL_GRACE_MS;
    });
    return !matched;
  });

  // Dedup → one row per deal (latest dial + count).
  const byDeal = new Map<string, UnloggedDial>();
  for (const d of unlogged) {
    const existing = byDeal.get(d.dealId);
    if (!existing) {
      byDeal.set(d.dealId, { dealId: d.dealId, lastDetectedAt: d.detectedAt, dialCount: 1 });
      continue;
    }
    existing.dialCount += 1;
    if (new Date(d.detectedAt).getTime() > new Date(existing.lastDetectedAt).getTime()) {
      existing.lastDetectedAt = d.detectedAt;
    }
  }
  return [...byDeal.values()];
}
