import { describe, it, expect } from "vitest";
import { CAPABILITIES, ROLE_LEVEL_OPTIONS, can, profileCan, type RoleLevel, type Capability } from "./capabilities";

const ALL: RoleLevel[] = [
  "administrator","cso_cro","svp_sales","vp_sales","director_sales","sales_manager","sales_professional",
];

describe("capability map", () => {
  it("defines a capability set for every role level", () => {
    for (const r of ALL) expect(CAPABILITIES[r]).toBeDefined();
  });

  it("assign role levels is administrator-only", () => {
    expect(can("administrator", "assignRoleLevels")).toBe(true);
    for (const r of ALL.filter((x) => x !== "administrator")) {
      expect(can(r, "assignRoleLevels")).toBe(false);
    }
  });

  it("invite users, set reporting lines, and org settings are administrator + CSO only", () => {
    for (const capability of ["inviteUsers","setReportingLines","editOrgSettings"] as Capability[]) {
      expect(can("administrator", capability)).toBe(true);
      expect(can("cso_cro", capability)).toBe(true);
      for (const r of ["svp_sales","vp_sales","director_sales","sales_manager","sales_professional"] as RoleLevel[]) {
        expect(can(r, capability)).toBe(false);
      }
    }
  });

  it("demo tools, integrations, billing, deactivate are administrator-only", () => {
    for (const capability of ["useDemoTools","manageIntegrations","manageBilling","deactivateUsers"] as Capability[]) {
      expect(can("administrator", capability)).toBe(true);
      expect(can("cso_cro", capability)).toBe(false);
      expect(can("sales_manager", capability)).toBe(false);
    }
  });

  it("editing deals/others' activities/partners is every manager layer but not reps", () => {
    for (const capability of ["editDealsInScope","deleteDeals","editOthersActivities","managePartnersInScope","viewTeamPage"] as Capability[]) {
      for (const r of ["administrator","cso_cro","svp_sales","vp_sales","director_sales","sales_manager"] as RoleLevel[]) {
        expect(can(r, capability)).toBe(true);
      }
      expect(can("sales_professional", capability)).toBe(false);
    }
  });

  it("can() is false for an unknown capability on any role", () => {
    expect(can("administrator", "nope" as Capability)).toBe(false);
  });
});

describe("ROLE_LEVEL_OPTIONS", () => {
  it("has one entry per role level (7 total)", () => {
    expect(ROLE_LEVEL_OPTIONS).toHaveLength(7);
  });

  it("maps administrator to the 'Administrator' label", () => {
    const admin = ROLE_LEVEL_OPTIONS.find((o) => o.value === "administrator");
    expect(admin?.label).toBe("Administrator");
  });

  it("covers every role level value exactly once", () => {
    const values = ROLE_LEVEL_OPTIONS.map((o) => o.value).sort();
    expect(values).toEqual([...ALL].sort());
  });
});

describe("profileCan", () => {
  it("reads role_level off a profile-like object", () => {
    expect(profileCan({ role_level: "cso_cro" }, "inviteUsers")).toBe(true);
    expect(profileCan({ role_level: "sales_manager" }, "inviteUsers")).toBe(false);
    expect(profileCan(null, "inviteUsers")).toBe(false);
  });
});
