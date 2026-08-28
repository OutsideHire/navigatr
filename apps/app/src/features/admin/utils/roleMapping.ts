/**
 * Role-level matching for the CSV team import.
 *
 * The importer no longer hard-fails a role value it doesn't recognize. Instead
 * the wizard groups the file by its distinct role values and lets the admin map
 * each one to a navigatr level (auto-selected when we recognize the label or
 * code, a deliberate pick when we don't). These pure helpers hold that logic so
 * the wizard stays thin and everything here is unit-tested.
 */
import { ROLE_LEVEL_OPTIONS, type RoleLevel } from "@/features/auth/capabilities";
import type { ParsedAgent } from "./parseAgentsCsv";
import type { InviteInput } from "../hooks/useAdminBulkInvite";

// Normalize for matching: lowercase, drop non-alphanumerics. Collapses
// "Sales Professional" / "sales_professional" / "SALES  PROFESSIONAL" to one
// key, and "CSO / CRO" / "cso_cro" to another.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Match a role string by its display label OR internal code -> the level.
const LOOKUP = new Map<string, RoleLevel>();
for (const o of ROLE_LEVEL_OPTIONS) {
  LOOKUP.set(norm(o.value), o.value);
  LOOKUP.set(norm(o.label), o.value);
}

/**
 * Resolve a raw role string. A blank value defaults to "sales_professional";
 * a recognized label/code returns its level; anything else returns null, which
 * the wizard surfaces as "needs a match".
 */
export function resolveRoleLevel(text: string): RoleLevel | null {
  const t = text.trim();
  if (!t) return "sales_professional";
  return LOOKUP.get(norm(t)) ?? null;
}

/** A distinct role value from the file -> the level chosen for it (null = not yet chosen). */
export type RoleMapping = Record<string, RoleLevel | null>;

/** The distinct raw role texts across the rows, in first-seen order. */
export function distinctRoleTexts(rows: Pick<ParsedAgent, "roleText">[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (!seen.has(r.roleText)) {
      seen.add(r.roleText);
      out.push(r.roleText);
    }
  }
  return out;
}

/** How many rows carry each distinct role text. */
export function roleTextCounts(rows: Pick<ParsedAgent, "roleText">[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.roleText] = (counts[r.roleText] ?? 0) + 1;
  return counts;
}

/** Initial mapping: each distinct value auto-resolved (null where unrecognized). */
export function initialRoleMapping(rows: Pick<ParsedAgent, "roleText">[]): RoleMapping {
  const mapping: RoleMapping = {};
  for (const t of distinctRoleTexts(rows)) mapping[t] = resolveRoleLevel(t);
  return mapping;
}

/** Whether every distinct role value has a chosen level. */
export function allRolesMapped(distinct: string[], mapping: RoleMapping): boolean {
  return distinct.every((t) => mapping[t] != null);
}

/**
 * Apply the mapping to the parsed rows to produce invite inputs. Assumes
 * allRolesMapped(distinct, mapping) is true; falls back to sales_professional
 * defensively so a caller bug can never send a null level to the RPC.
 */
export function applyRoleMapping(rows: ParsedAgent[], mapping: RoleMapping): InviteInput[] {
  return rows.map((r) => {
    const input: InviteInput = {
      email: r.email,
      full_name: r.full_name,
      role_level: mapping[r.roleText] ?? "sales_professional",
    };
    if (r.reports_to) input.reports_to = r.reports_to;
    return input;
  });
}
