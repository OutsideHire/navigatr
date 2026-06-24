/**
 * SP1 call-coverage counting: how many click-to-call dials (past the 4h grace,
 * within the caller-supplied window) were logged as a Call activity. Same rule
 * as the frontend lib/unloggedDials.ts, returning counts instead of rows.
 * Pure + dependency-free (vitest-tested via the _shared include).
 */
import { CALL_GRACE_MS } from "./config.ts";

export interface DialSignal {
  dealId: string;
  detectedAt: string; // ISO
}
export interface CallActivity {
  dealId: string;
  occurredAt: string; // ISO
}

export function countCallDials(
  dials: DialSignal[],
  calls: CallActivity[],
  now: Date,
  graceMs: number = CALL_GRACE_MS,
): { totalDials: number; matchedDials: number } {
  const nowMs = now.getTime();
  let totalDials = 0;
  let matchedDials = 0;
  for (const d of dials) {
    const detectedMs = new Date(d.detectedAt).getTime();
    if (nowMs - detectedMs < graceMs) continue; // pending — not yet gradeable
    totalDials += 1;
    const matched = calls.some((a) => {
      if (a.dealId !== d.dealId) return false;
      const occurredMs = new Date(a.occurredAt).getTime();
      return occurredMs >= detectedMs && occurredMs <= detectedMs + graceMs;
    });
    if (matched) matchedDials += 1;
  }
  return { totalDials, matchedDials };
}
