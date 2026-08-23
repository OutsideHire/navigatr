/**
 * Capability map (PRD 6.8.A permission matrix). Single client-side source of
 * truth for which role_level may do what. The SERVER (RLS + RPC gates) is
 * authoritative; this map only drives showing/disabling UI so users never see
 * actions they cannot perform. Scope (own/tree/company) is enforced separately
 * by the reporting tree; these booleans are the "is this action allowed at all"
 * layer of the matrix.
 */
export type RoleLevel =
  | "administrator" | "cso_cro" | "svp_sales" | "vp_sales"
  | "director_sales" | "sales_manager" | "sales_professional";

/**
 * Human labels for the 7 role levels, ordered top-to-bottom of the hierarchy.
 * Shared by the invite modal + CSV import so the admin picks a role LEVEL.
 */
export const ROLE_LEVEL_OPTIONS: { value: RoleLevel; label: string }[] = [
  { value: "administrator", label: "Administrator" },
  { value: "cso_cro", label: "CSO / CRO" },
  { value: "svp_sales", label: "SVP of Sales" },
  { value: "vp_sales", label: "VP of Sales" },
  { value: "director_sales", label: "Director of Sales" },
  { value: "sales_manager", label: "Sales Manager" },
  { value: "sales_professional", label: "Sales Professional" },
];

const ROLE_LEVEL_LABELS: Record<RoleLevel, string> = ROLE_LEVEL_OPTIONS.reduce(
  (acc, o) => {
    acc[o.value] = o.label;
    return acc;
  },
  {} as Record<RoleLevel, string>,
);

/**
 * The canonical display label for a role level (PRD 6.12.A D-01 / FR-HIER-26/27).
 * Every user-facing surface that shows a role name resolves it through here so
 * the seven labels stay consistent (never the abbreviated legacy "Rep"). Null /
 * unknown renders an em-dash placeholder.
 */
export function roleLevelLabel(level: RoleLevel | null | undefined): string {
  return level ? ROLE_LEVEL_LABELS[level] ?? "—" : "—";
}

export type Capability =
  | "inviteUsers" | "assignRoleLevels" | "setReportingLines" | "deactivateUsers"
  | "editOrgSettings" | "manageIntegrations" | "manageBilling" | "useDemoTools"
  | "editDealsInScope" | "deleteDeals" | "editOthersActivities"
  | "managePartnersInScope" | "viewTeamPage";

// Manager-band capabilities shared by every layer above rep.
const MANAGER_BAND: Capability[] = [
  "editDealsInScope", "deleteDeals", "editOthersActivities",
  "managePartnersInScope", "viewTeamPage",
];

const ADMIN_ONLY: Capability[] = [
  "assignRoleLevels", "deactivateUsers", "manageIntegrations", "manageBilling", "useDemoTools",
];

// Administrator + CSO share these.
const ADMIN_CSO: Capability[] = ["inviteUsers", "setReportingLines", "editOrgSettings"];

function setFor(caps: Capability[]): Set<Capability> {
  return new Set(caps);
}

export const CAPABILITIES: Record<RoleLevel, Set<Capability>> = {
  administrator: setFor([...ADMIN_ONLY, ...ADMIN_CSO, ...MANAGER_BAND]),
  cso_cro: setFor([...ADMIN_CSO, ...MANAGER_BAND]),
  svp_sales: setFor([...MANAGER_BAND]),
  vp_sales: setFor([...MANAGER_BAND]),
  director_sales: setFor([...MANAGER_BAND]),
  sales_manager: setFor([...MANAGER_BAND]),
  sales_professional: setFor([]),
};

/** Whether a role level has a capability. Unknown role/capability => false. */
export function can(role: RoleLevel | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return CAPABILITIES[role]?.has(capability) ?? false;
}

/** Capability check off a profile-shaped object ({ role_level }). */
export function profileCan(
  profile: { role_level: RoleLevel } | null | undefined,
  capability: Capability,
): boolean {
  return can(profile?.role_level, capability);
}
