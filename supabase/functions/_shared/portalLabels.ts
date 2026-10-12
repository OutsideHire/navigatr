/**
 * Partner-facing status labels (Partner Portal, spec 5.6, FR-PORT-62).
 *
 * The ONLY place an internal referral status becomes something a partner reads.
 * portal_api responses (and, in Phase 1C, partner emails) go through here, so an
 * internal status name can never reach the portal: anything unknown maps to null
 * and the caller drops it. Rep-facing labels live in
 * apps/app/src/features/partners/lib/referrals.ts and never mix with these.
 *
 * Pure TS, no Deno globals: vitest covers it and the edge imports it with .ts.
 */
export type PortalLabel =
  | "Received"
  | "Accepted"
  | "In Progress"
  | "Closed Won"
  | "Not Moving Forward"
  | "Withdrawn";

export const PORTAL_LABELS: readonly PortalLabel[] = [
  "Received",
  "Accepted",
  "In Progress",
  "Closed Won",
  "Not Moving Forward",
  "Withdrawn",
];

const LABEL_BY_STATUS: Readonly<Record<string, PortalLabel>> = Object.freeze({
  submitted: "Received",
  accepted: "Accepted",
  working: "In Progress",
  won: "Closed Won",
  lost: "Not Moving Forward",
  declined: "Not Moving Forward",
  withdrawn: "Withdrawn",
});

export function portalLabel(status: unknown): PortalLabel | null {
  if (typeof status !== "string") return null;
  return Object.prototype.hasOwnProperty.call(LABEL_BY_STATUS, status) ? LABEL_BY_STATUS[status] : null;
}

export interface PortalHistoryEntry {
  label: PortalLabel;
  at: string;
}

/** Labels only, oldest first, with consecutive repeats collapsed (lost then declined is one step). */
export function collapseHistory(entries: ReadonlyArray<{ status: unknown; at: unknown }>): PortalHistoryEntry[] {
  const out: PortalHistoryEntry[] = [];
  for (const entry of entries) {
    const label = portalLabel(entry.status);
    if (!label || typeof entry.at !== "string") continue;
    if (out.length > 0 && out[out.length - 1].label === label) continue;
    out.push({ label, at: entry.at });
  }
  return out;
}
