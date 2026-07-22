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
