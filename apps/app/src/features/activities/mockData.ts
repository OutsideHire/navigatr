/**
 * Activities mock — Sprint 1.
 *
 * Activities are scoped to deals (dealId FK). A canonical activity is
 * one of {call, email, drop_in, appointment}. Sprint 1 implements logging
 * for `call` only; the type union keeps the others ready for Sprint 2.
 *
 * TODO Sprint 2: swap to TanStack Query + generated SDK
 * (Activities.listByDeal / Activities.create).
 */

import type { Disposition } from "@/lib/followUpScheduling";

export type ActivityType = "call" | "email" | "drop_in" | "appointment";

export interface Activity {
  id: string;
  dealId: string;
  type: ActivityType;
  /** Minutes. Required for call/appointment; null for email/drop_in. */
  durationMinutes: number | null;
  disposition: Disposition;
  outcomeNotes: string;
  occurredAt: string; // ISO
  /** Calculated follow-up date for the activity (null when terminal). */
  followUpDate: string | null;
  /** UUID of the user who logged this activity. Present on org-wide queries. */
  loggedBy?: string | null;
}

const TODAY = new Date("2026-04-30T12:00:00Z");
function isoDaysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

// A few seeded activities so a freshly-loaded deal detail page isn't
// completely empty. Tied to deals from pipeline/mockData.ts.
export const MOCK_ACTIVITIES: Activity[] = [
  {
    id: "a-001",
    dealId: "d-206", // Urban Outfitters Local (qualified)
    type: "call",
    durationMinutes: 23,
    disposition: "positive_engagement",
    outcomeNotes: "Spoke with Sarah. Walked her through the rate comparison. She wants a follow-up next week with a written proposal.",
    occurredAt: isoDaysAgo(2),
    followUpDate: isoDaysAgo(-3),
    loggedBy: null,
  },
  {
    id: "a-002",
    dealId: "d-206",
    type: "call",
    durationMinutes: 7,
    disposition: "dm_unavailable",
    outcomeNotes: "DM was in a meeting. Left voicemail.",
    occurredAt: isoDaysAgo(5),
    followUpDate: isoDaysAgo(-2),
    loggedBy: null,
  },
  {
    id: "a-003",
    dealId: "d-301", // Alpine Wellness (proposal)
    type: "call",
    durationMinutes: 38,
    disposition: "statement_secured",
    outcomeNotes: "Got the last 3 months of processing statements. Effective rate is 2.94%. Big opportunity — we can take that to 2.45%.",
    occurredAt: isoDaysAgo(1),
    followUpDate: isoDaysAgo(0),
    loggedBy: null,
  },
];

export function activitiesForDeal(dealId: string): Activity[] {
  return MOCK_ACTIVITIES
    .filter((a) => a.dealId === dealId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** In-memory append store — used by the Log Activity sheet's mock submit
 *  so a logged call surfaces on the Deal detail page without a backend. */
export function appendActivity(a: Activity): void {
  MOCK_ACTIVITIES.unshift(a);
}
