/**
 * Shared scope vocabulary for Pipeline and Partners (PRD 6.12.A Bundle 3).
 *
 * Both modules render the same "whose records am I looking at" language and the
 * same per-card scope tags, so the wording lives in one place (the single
 * contract FR-HIER-16/17 call for). Pure + fully unit-tested; the React glue is
 * useViewerScope + the module headers.
 */

import type { RoleLevel } from "@/features/auth/capabilities";

/** you = individual contributor's own book; team = a manager's subtree; org =
 *  whole-organization view (top of the tree / administrator). */
export type ScopeLevel = "you" | "team" | "org";

/** The scope a viewer sees by default, before any seller/team filter.
 *  Org for the organization-wide roles (administrator sees the whole org via
 *  the fail-closed admin exemption; CSO/CRO sits at the top of the tree).
 *  Team for anyone else who has at least one report in their subtree.
 *  You for an individual contributor with no reports. */
export function resolveScopeLevel(
  roleLevel: RoleLevel | null | undefined,
  hasReports: boolean,
): ScopeLevel {
  if (roleLevel === "administrator" || roleLevel === "cso_cro") return "org";
  return hasReports ? "team" : "you";
}

type ScopeModule = "pipeline" | "partners";

const PHRASES: Record<ScopeModule, Record<ScopeLevel, string>> = {
  pipeline: {
    you: "Your pipeline",
    team: "Your team's pipeline",
    org: "Your organization's pipeline",
  },
  partners: {
    you: "Your partners",
    team: "Your team's partners",
    org: "Your organization's partners",
  },
};

/** The scope-line phrase for a module (FR-HIER-16). When a seller/team filter is
 *  active the caller passes the filtered name instead, which wins over the
 *  default phrase (Slice 2 wiring). */
export function scopePhrase(
  module: ScopeModule,
  level: ScopeLevel,
  filteredName?: string | null,
): string {
  const name = filteredName?.trim();
  if (name) return name;
  return PHRASES[module][level];
}

/** Short tag beside a metric-card label (FR-HIER-17). A seller filter shows the
 *  seller's first name; otherwise You / Team / Org. */
export function scopeTagLabel(
  level: ScopeLevel,
  filteredSellerName?: string | null,
): string {
  const name = filteredSellerName?.trim();
  if (name) return name.split(/\s+/)[0]!; // first name
  return level === "you" ? "You" : level === "team" ? "Team" : "Org";
}
