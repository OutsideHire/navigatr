/**
 * Role-management affordance helpers (admin-only role changes). Pure — the UI
 * uses these to decide which role-change menu items to show; the admin_set_role
 * RPC enforces the same rules authoritatively server-side.
 */
export type UserRole = "rep" | "manager" | "admin";

type LeaderboardStatus = "active" | "invited" | "revoked";

const ALL_ROLES: UserRole[] = ["rep", "manager", "admin"];
const RANK: Record<UserRole, number> = { rep: 0, manager: 1, admin: 2 };

/** Roles an admin caller may set for `target` (drives the row's menu items). */
export function settableRoles(
  callerRole: UserRole | undefined,
  target: { id: string; role: UserRole; status: LeaderboardStatus },
  ctx: { selfId: string | undefined; activeAdminCount: number },
): UserRole[] {
  if (callerRole !== "admin") return [];
  if (target.id === ctx.selfId) return [];
  if (target.status !== "active") return [];
  return ALL_ROLES.filter((r) => {
    if (r === target.role) return false;
    if (target.role === "admin" && r !== "admin" && ctx.activeAdminCount <= 1) return false;
    return true;
  });
}

/** Directional menu label, e.g. "Promote to manager" / "Demote to rep". */
export function roleChangeLabel(current: UserRole, target: UserRole): string {
  return RANK[target] > RANK[current] ? `Promote to ${target}` : `Demote to ${target}`;
}
