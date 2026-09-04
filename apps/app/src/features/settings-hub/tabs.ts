/**
 * tabs.ts — single source of truth for Settings hub tab definitions.
 *
 * Each tab carries:
 *   id     : URL slug (`?tab=<id>` on desktop, `/settings/<id>` on mobile)
 *   label  : display name in the left rail
 *   roles  : which user_role values may see + access this tab
 *   group  : which sub-nav group cluster this tab belongs to (the renderer
 *            inserts a group label whenever the group changes)
 *
 * The role array uses the same enum as the rest of the app (`user_role`
 * from auth.ts: 'rep' | 'manager' | 'admin'). When the 7-role hierarchy
 * RLS work lands later, this list extends without changing the gating
 * mechanism.
 *
 * Adding a future tab (Members, Billing, Audit log): append an entry
 * here + a content component. No other coordination needed.
 */
// Mirrors the inline role union used by useProfile + RequireRole.
// Defined here (not imported) because the rest of the app uses inline
// literals rather than a shared type alias. When that's consolidated
// later, swap this for the canonical import.
export type UserRole = "rep" | "manager" | "admin";

export type SettingsTabId =
  | "personal"
  | "organization"
  | "integrations"
  | "branding"
  | "profession"
  | "danger";

/**
 * Logical groups for the sub-nav rail. Replaces the single "ADMIN" divider
 * pattern with three labeled clusters that mirror how users mentally
 * organize settings:
 *
 *   Account   — "this is about me" (personal info, org membership)
 *   Workspace — "this is about how we look + work" (branding, profession)
 *   Advanced  — "this is dangerous or rarely-used" (danger zone, future
 *               admin tabs like audit log)
 */
export type SettingsGroup = "account" | "workspace" | "advanced";

export const GROUP_LABEL: Record<SettingsGroup, string> = {
  account: "Account",
  workspace: "Workspace",
  advanced: "Advanced",
};

export interface SettingsTabDef {
  id: SettingsTabId;
  label: string;
  /** Which roles can see + access this tab. */
  roles: UserRole[];
  /** Sub-nav group this tab belongs to. */
  group: SettingsGroup;
}

/** Order matters — this is the order tabs render in the left rail.
 *  Tabs are clustered by group; the renderer inserts a group label
 *  whenever the group changes between adjacent tabs. */
export const SETTINGS_TABS: SettingsTabDef[] = [
  { id: "personal",     label: "Personal",     roles: ["rep", "manager", "admin"], group: "account"   },
  { id: "organization", label: "Organization", roles: ["rep", "manager", "admin"], group: "account"   },
  { id: "integrations", label: "Integrations", roles: ["rep", "manager", "admin"], group: "account"   },
  { id: "branding",     label: "Branding",     roles: ["admin"],                   group: "workspace" },
  { id: "profession",   label: "Profession",   roles: ["manager", "admin"],        group: "workspace" },
  { id: "danger",       label: "Danger zone",  roles: ["admin"],                   group: "advanced"  },
];

/**
 * Filter the tab list to those visible to the given role. Pure function,
 * easy to unit-test.
 */
export function visibleTabs(role: UserRole | undefined): SettingsTabDef[] {
  if (!role) return SETTINGS_TABS.filter((t) => t.roles.includes("rep"));
  return SETTINGS_TABS.filter((t) => t.roles.includes(role));
}

/**
 * Resolve a raw URL tab parameter to a valid tab for this user.
 * - Unknown id → 'personal' (always valid)
 * - Known but role-forbidden id → 'personal'
 * - Known + role-allowed → the requested id
 *
 * Returns the resolved id + whether a redirect was forced. Callers use
 * the redirect flag to decide whether to push or replace history.
 */
export function resolveTab(
  raw: string | null | undefined,
  role: UserRole | undefined,
): { id: SettingsTabId; redirected: boolean } {
  const valid = visibleTabs(role);
  const match = valid.find((t) => t.id === raw);
  if (match) return { id: match.id, redirected: false };
  // Default to 'personal' which is visible to every role. Treat null,
  // undefined, and empty string as "no tab requested" → no redirect.
  // A *non-empty* unknown or role-forbidden value IS a redirect.
  const noRequest = raw === null || raw === undefined || raw === "";
  return { id: "personal", redirected: !noRequest };
}
