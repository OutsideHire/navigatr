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
  /**
   * Deferred reporting line as an email, for a row whose manager has no profile
   * id yet (a pending CSV invite reporting to a manager who is ALSO a pending
   * invite, or a rep who accepted before their manager). When `manager_id`
   * doesn't resolve to an in-list node, the tree falls back to matching this
   * email to whichever node owns it, so same-file teams nest pre-accept instead
   * of rendering flat. Optional: absent/null means "no deferred line".
   */
  reports_to_email?: string | null;
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

  // email -> agent_id, so a deferred reporting line (reports_to_email) can be
  // matched to whichever node owns that email. When an email is shared by an
  // active member and a stale pending invite, the ACTIVE member wins so a
  // reporting line resolves to the real manager, not the leftover invite.
  const idByEmail = new Map<string, string>();
  for (const r of rows) {
    const key = r.email?.toLowerCase();
    if (!key) continue;
    const existing = idByEmail.get(key);
    if (existing == null) {
      idByEmail.set(key, r.agent_id);
    } else if (byId.get(existing)?.status !== "active" && r.status === "active") {
      idByEmail.set(key, r.agent_id);
    }
  }

  // The parent node id for a row, or null if it's a root. Prefer the real
  // manager_id edge; fall back to reports_to_email only when manager_id doesn't
  // resolve to an in-list node (a pending invite whose manager is also pending,
  // or a rep who accepted before their manager). Never self-parent.
  const parentOf = (r: T): string | null => {
    if (r.manager_id != null && byId.has(r.manager_id)) return r.manager_id;
    const rte = r.reports_to_email?.toLowerCase();
    if (rte) {
      const pid = idByEmail.get(rte);
      if (pid != null && pid !== r.agent_id) return pid;
    }
    return null;
  };

  // Group provisional children under their (in-list) manager; collect roots.
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const r of rows) {
    const mgr = parentOf(r);
    if (mgr == null) {
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
