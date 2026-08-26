import { describe, it, expect } from "vitest";
import { settableRoles, roleChangeLabel, isPendingRoleChange, type UserRole } from "./roleActions";

const t = (over: Partial<{ id: string; role: UserRole; status: "active" | "invited" | "revoked" }> = {}) => ({
  id: "u2", role: "rep" as UserRole, status: "active" as const, ...over,
});
const ctx = (over: Partial<{ selfId: string | undefined; activeAdminCount: number }> = {}) => ({
  selfId: "me", activeAdminCount: 2, ...over,
});

describe("settableRoles", () => {
  it("offers nothing to a non-admin caller", () => {
    expect(settableRoles("manager", t(), ctx())).toEqual([]);
    expect(settableRoles("rep", t(), ctx())).toEqual([]);
    expect(settableRoles(undefined, t(), ctx())).toEqual([]); // unknown caller role
  });
  it("offers the two other roles to an admin", () => {
    expect(settableRoles("admin", t({ role: "rep" }), ctx())).toEqual(["manager", "admin"]);
    expect(settableRoles("admin", t({ role: "manager" }), ctx())).toEqual(["rep", "admin"]);
  });
  it("offers nothing for the caller's own row", () => {
    expect(settableRoles("admin", t({ id: "me" }), ctx({ selfId: "me" }))).toEqual([]);
  });
  it("offers nothing for an inactive member", () => {
    expect(settableRoles("admin", t({ status: "invited" }), ctx())).toEqual([]);
    expect(settableRoles("admin", t({ status: "revoked" }), ctx())).toEqual([]);
  });
  it("suppresses demoting the sole active admin", () => {
    expect(settableRoles("admin", t({ role: "admin" }), ctx({ activeAdminCount: 1 }))).toEqual([]);
    expect(settableRoles("admin", t({ role: "admin" }), ctx({ activeAdminCount: 2 }))).toEqual(["rep", "manager"]);
  });
});

describe("roleChangeLabel", () => {
  it("labels elevations as Promote and reductions as Demote", () => {
    expect(roleChangeLabel("rep", "manager")).toBe("Promote to manager");
    expect(roleChangeLabel("rep", "admin")).toBe("Promote to admin");
    expect(roleChangeLabel("admin", "manager")).toBe("Demote to manager");
    expect(roleChangeLabel("manager", "rep")).toBe("Demote to rep");
  });
});

describe("isPendingRoleChange", () => {
  it("is true when an admin views a pending (invited) other member", () => {
    expect(isPendingRoleChange("admin", { id: "u2", status: "invited" }, "me")).toBe(true);
  });
  it("is false for an active member (settableRoles handles those)", () => {
    expect(isPendingRoleChange("admin", { id: "u2", status: "active" }, "me")).toBe(false);
  });
  it("is false for self, a revoked member, or a non-admin caller", () => {
    expect(isPendingRoleChange("admin", { id: "me", status: "invited" }, "me")).toBe(false);
    expect(isPendingRoleChange("admin", { id: "u2", status: "revoked" }, "me")).toBe(false);
    expect(isPendingRoleChange("manager", { id: "u2", status: "invited" }, "me")).toBe(false);
    expect(isPendingRoleChange(undefined, { id: "u2", status: "invited" }, "me")).toBe(false);
  });
});
