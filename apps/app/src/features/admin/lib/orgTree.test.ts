import { describe, it, expect } from "vitest";
import { buildOrgTree, type OrgTreeInput, type OrgTreeNode } from "./orgTree";

/** Minimal row factory — only the fields buildOrgTree reads. */
function row(over: Partial<OrgTreeInput> & { agent_id: string }): OrgTreeInput {
  return {
    full_name: null,
    email: `${over.agent_id}@x.com`,
    role_level: null,
    manager_id: null,
    status: "active",
    ...over,
  };
}

/** Flatten a forest into "<id>@<depth>" tokens in traversal order. */
function flatten(nodes: OrgTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: OrgTreeNode[]) => {
    for (const n of list) {
      out.push(`${n.row.agent_id}@${n.depth}`);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

describe("buildOrgTree", () => {
  it("returns [] for empty input", () => {
    expect(buildOrgTree([])).toEqual([]);
  });

  it("nests children under a single root, depth incrementing", () => {
    const rows = [
      row({ agent_id: "admin", role_level: "administrator" }),
      row({ agent_id: "mgr", role_level: "sales_manager", manager_id: "admin" }),
      row({ agent_id: "rep", role_level: "sales_professional", manager_id: "mgr" }),
    ];
    const tree = buildOrgTree(rows);
    expect(flatten(tree)).toEqual(["admin@0", "mgr@1", "rep@2"]);
  });

  it("handles multiple layers with several children", () => {
    const rows = [
      row({ agent_id: "admin", role_level: "administrator" }),
      row({ agent_id: "m1", role_level: "sales_manager", manager_id: "admin", full_name: "Bob" }),
      row({ agent_id: "m2", role_level: "sales_manager", manager_id: "admin", full_name: "Ann" }),
      row({ agent_id: "r1", role_level: "sales_professional", manager_id: "m1" }),
    ];
    const tree = buildOrgTree(rows);
    expect(tree).toHaveLength(1);
    // Two managers under admin, ordered by name (Ann before Bob) at same level.
    const admin = tree[0];
    expect(admin.children.map((c) => c.row.agent_id)).toEqual(["m2", "m1"]);
    // r1 nested under m1.
    const m1 = admin.children.find((c) => c.row.agent_id === "m1")!;
    expect(m1.children.map((c) => c.row.agent_id)).toEqual(["r1"]);
    expect(m1.children[0].depth).toBe(2);
  });

  it("treats a null manager_id as a root", () => {
    const rows = [row({ agent_id: "top", role_level: "cso_cro" })];
    const tree = buildOrgTree(rows);
    expect(tree.map((n) => n.row.agent_id)).toEqual(["top"]);
    expect(tree[0].depth).toBe(0);
  });

  it("promotes an orphan (manager_id not present among rows) to a root", () => {
    const rows = [
      row({ agent_id: "root", role_level: "administrator" }),
      // manager 'ghost' is not in rows → orphan becomes a root, not dropped.
      row({ agent_id: "orphan", role_level: "sales_professional", manager_id: "ghost" }),
    ];
    const tree = buildOrgTree(rows);
    const ids = tree.map((n) => n.row.agent_id).sort();
    expect(ids).toEqual(["orphan", "root"]);
    // Nobody is dropped.
    expect(flatten(tree)).toHaveLength(2);
  });

  it("orders siblings by role_level rank, then by name (case-insensitive)", () => {
    const rows = [
      row({ agent_id: "root", role_level: "administrator" }),
      row({ agent_id: "a", role_level: "sales_professional", manager_id: "root", full_name: "zoe" }),
      row({ agent_id: "b", role_level: "director_sales", manager_id: "root", full_name: "Yuri" }),
      row({ agent_id: "c", role_level: "director_sales", manager_id: "root", full_name: "adam" }),
      row({ agent_id: "d", role_level: null, manager_id: "root", full_name: "AAA" }),
    ];
    const tree = buildOrgTree(rows);
    // director_sales (adam, Yuri) before sales_professional (zoe) before null (AAA).
    expect(tree[0].children.map((c) => c.row.agent_id)).toEqual(["c", "b", "a", "d"]);
  });

  it("falls back to email for name ordering when full_name is null", () => {
    const rows = [
      row({ agent_id: "root", role_level: "administrator" }),
      row({ agent_id: "z1", role_level: "sales_manager", manager_id: "root", email: "zed@x.com" }),
      row({ agent_id: "a1", role_level: "sales_manager", manager_id: "root", email: "abe@x.com" }),
    ];
    const tree = buildOrgTree(rows);
    expect(tree[0].children.map((c) => c.row.agent_id)).toEqual(["a1", "z1"]);
  });

  it("orders multiple roots deterministically too", () => {
    const rows = [
      row({ agent_id: "rep", role_level: "sales_professional", full_name: "Rep" }),
      row({ agent_id: "admin", role_level: "administrator", full_name: "Admin" }),
    ];
    const tree = buildOrgTree(rows);
    expect(tree.map((n) => n.row.agent_id)).toEqual(["admin", "rep"]);
  });

  it("does not infinite-loop on a 2-node cycle and terminates", () => {
    const rows = [
      row({ agent_id: "x", role_level: "sales_manager", manager_id: "y" }),
      row({ agent_id: "y", role_level: "sales_manager", manager_id: "x" }),
    ];
    const tree = buildOrgTree(rows);
    // Cycle broken: every node still appears exactly once across the forest.
    expect(flatten(tree).map((t) => t.split("@")[0]).sort()).toEqual(["x", "y"]);
  });

  it("breaks a self-referential cycle by treating the node as a root", () => {
    const rows = [row({ agent_id: "solo", role_level: "sales_manager", manager_id: "solo" })];
    const tree = buildOrgTree(rows);
    expect(tree.map((n) => n.row.agent_id)).toEqual(["solo"]);
    expect(tree[0].depth).toBe(0);
  });
});
