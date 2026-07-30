/**
 * Canonical lead-source taxonomy (single source of truth). Replaces the old
 * free-text picklists that were duplicated across the deal sheets. Encodes the
 * "Report rules" from Robert's Lead Source spec:
 *   - System-set sources (Path, Partner Referral, Assigned, Import) are stamped
 *     by the platform; reps never pick them.
 *   - Rep-set sources are the manual picklist; "Other" requires a note.
 *   - "Unknown" is the unset/legacy default.
 *   - A deal's source is written once at creation and locked, except while it
 *     is still Other or Unknown (then a rep may change it).
 */

export const LEAD_SOURCE_VALUES = [
  // System-set (stamped by the platform; Assigned + Import are future producers)
  "path",
  "partner_referral",
  "assigned",
  "import",
  // Rep-set (manual picklist)
  "self_sourced_canvass",
  "customer_referral",
  "event_association",
  "inbound",
  "other",
  // Unset / legacy default
  "unknown",
] as const;

export type LeadSource = (typeof LEAD_SOURCE_VALUES)[number];

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  path: "Path",
  partner_referral: "Partner Referral",
  assigned: "Assigned",
  import: "Import",
  self_sourced_canvass: "Self-Sourced Canvass",
  customer_referral: "Customer Referral",
  event_association: "Event / Association",
  inbound: "Inbound",
  other: "Other",
  unknown: "Unknown",
};

const SYSTEM_SET_SOURCES = new Set<LeadSource>(["path", "partner_referral", "assigned", "import"]);

export type LeadSourceSetBy = "system" | "rep" | "unknown";

/** Who set the source: the platform (system), a rep, or nobody yet (unknown). */
export function leadSourceSetBy(v: string | null | undefined): LeadSourceSetBy {
  if (v == null || v === "" || v === "unknown") return "unknown";
  return SYSTEM_SET_SOURCES.has(v as LeadSource) ? "system" : "rep";
}

/** The sources a rep may pick manually (never the system-set four, never Unknown). */
export const REP_PICKABLE_SOURCES: LeadSource[] = [
  "self_sourced_canvass",
  "customer_referral",
  "event_association",
  "inbound",
  "other",
];

/** Select options for the rep-facing picklist. */
export const REP_SOURCE_OPTIONS = REP_PICKABLE_SOURCES.map((value) => ({
  value,
  label: LEAD_SOURCE_LABEL[value],
}));

/**
 * "First touch, set once": a deal's source is locked after creation, EXCEPT
 * while it is still Other or Unknown (a rep may correct those). System-set
 * sources are always locked.
 */
export function isLeadSourceEditable(current: string | null | undefined): boolean {
  return current == null || current === "" || current === "unknown" || current === "other";
}

export function isKnownLeadSource(v: string | null | undefined): v is LeadSource {
  return v != null && (LEAD_SOURCE_VALUES as readonly string[]).includes(v);
}

/** Human label for any stored value; unknown/legacy strings fall back to "Unknown". */
export function leadSourceLabel(v: string | null | undefined): string {
  return isKnownLeadSource(v) ? LEAD_SOURCE_LABEL[v] : "Unknown";
}

/** "Other" is the only rep-set source that requires a free-text note. */
export function leadSourceRequiresNote(v: string | null | undefined): boolean {
  return v === "other";
}

/**
 * "Rep sourced" = prospecting channels. Excludes the non-prospecting system
 * sources (Assigned, Import) and the unset Unknown bucket, per the Lead Source
 * report's default "Rep sourced only" scope.
 */
export function isRepSourcedSource(v: string | null | undefined): boolean {
  return isKnownLeadSource(v) && v !== "assigned" && v !== "import" && v !== "unknown";
}
