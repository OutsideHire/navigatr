/**
 * orgTree — pure helper that turns a flat list of team rows (each carrying a
 * `manager_id`) into a forest of OrgTreeNodes for the Team page org chart.
 *
 * Design points:
 * - Roots are rows with no manager, OR whose manager_id is not present among
 *   the supplied rows (orphans become roots so nobody is silently dropped).
 * - Siblings are ordered deterministically: by role_level rank (top of the
 *   hierarchy first, null last), then by display name (email fallback),
 *   case-insensitive.
 * - Cycle-safe: a manager chain that loops (x → y → x, or self-reference) is
 *   broken via a visited set so traversal always terminates; the node whose
 *   edge is broken surfaces as a root.
 *
 * This file is UI-agnostic and fully unit-tested (orgTree.test.ts).
 */
import type { RoleLevel } from "@/features/auth/capabilities";

/**
 * Minimal shape buildOrgTree needs. LeaderboardRow structurally satisfies this,
 * so callers pass their rows directly without mapping.
 */
export interface OrgTreeInput {
  agent_id: string;
  full_name: string | null;
  email: string;
  role_level: RoleLevel | null;
  manager_id: string | null;
  status: "active" | "invited" | "revoked";
}

export interface OrgTreeNode<T extends OrgTreeInput = OrgTreeInput> {
  row: T;
  children: OrgTreeNode<T>[];
  depth: number;
}

/** Rank of each role level for sibling ordering; null sorts last. */
const ROLE_RANK: Record<RoleLevel, number> = {
  administrator: 0,
  cso_cro: 1,
  svp_sales: 2,
  vp_sales: 3,
  director_sales: 4,
  sales_manager: 5,
  sales_professional: 6,
};

function rankOf(role: RoleLevel | null): number {
  return role == null ? Number.MAX_SAFE_INTEGER : ROLE_RANK[role];
}

function nameKey(row: OrgTreeInput): string {
  return (row.full_name ?? row.email ?? "").toLowerCase();
}

function compareSiblings(a: OrgTreeInput, b: OrgTreeInput): number {
  const byRank = rankOf(a.role_level) - rankOf(b.role_level);
  if (byRank !== 0) return byRank;
  return nameKey(a).localeCompare(nameKey(b));
}

/**
 * Build the org forest from a flat row list. Returns roots (depth 0) with their
 * descendants nested beneath. Pure and deterministic.
 */
export function buildOrgTree<T extends OrgTreeInput>(rows: T[]): OrgTreeNode<T>[] {
  const byId = new Map<string, T>();
  for (const r of rows) byId.set(r.agent_id, r);

  // Group provisional children under their (in-list) manager; collect roots.
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const r of rows) {
    const mgr = r.manager_id;
    if (mgr == null || !byId.has(mgr)) {
      roots.push(r);
    } else {
      const bucket = childrenOf.get(mgr);
      if (bucket) bucket.push(r);
      else childrenOf.set(mgr, [r]);
    }
  }

  const visited = new Set<string>();

  const buildNode = (row: T, depth: number): OrgTreeNode<T> => {
    visited.add(row.agent_id);
    const kids = (childrenOf.get(row.agent_id) ?? [])
      .filter((c) => !visited.has(c.agent_id)) // cycle-safe: never revisit
      .sort(compareSiblings)
      .map((c) => buildNode(c, depth + 1));
    return { row, children: kids, depth };
  };

  const forest = [...roots].sort(compareSiblings).map((r) => buildNode(r, 0));

  // Any row still unvisited belongs to a pure cycle (no member reaches a real
  // root). Promote such nodes to roots in deterministic order, breaking the
  // back-edge so traversal terminates and nobody is dropped.
  const leftover = rows.filter((r) => !visited.has(r.agent_id)).sort(compareSiblings);
  for (const r of leftover) {
    if (!visited.has(r.agent_id)) forest.push(buildNode(r, 0));
  }

  return forest;
}
