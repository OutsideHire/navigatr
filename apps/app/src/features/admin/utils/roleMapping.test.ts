import { describe, it, expect } from "vitest";
import {
  resolveRoleLevel,
  distinctRoleTexts,
  roleTextCounts,
  initialRoleMapping,
  allRolesMapped,
  applyRoleMapping,
} from "./roleMapping";
import type { ParsedAgent } from "./parseAgentsCsv";

const row = (over: Partial<ParsedAgent> & { email: string }): ParsedAgent => ({
  full_name: null,
  roleText: "",
  ...over,
});

describe("resolveRoleLevel", () => {
  it("resolves the human labels an admin copies from the UI", () => {
    expect(resolveRoleLevel("Sales Professional")).toBe("sales_professional");
    expect(resolveRoleLevel("Sales Manager")).toBe("sales_manager");
    expect(resolveRoleLevel("Director of Sales")).toBe("director_sales");
    expect(resolveRoleLevel("VP of Sales")).toBe("vp_sales");
    expect(resolveRoleLevel("SVP of Sales")).toBe("svp_sales");
    expect(resolveRoleLevel("CSO / CRO")).toBe("cso_cro");
    expect(resolveRoleLevel("Administrator")).toBe("administrator");
  });

  it("resolves the internal codes too", () => {
    expect(resolveRoleLevel("sales_professional")).toBe("sales_professional");
    expect(resolveRoleLevel("vp_sales")).toBe("vp_sales");
    expect(resolveRoleLevel("cso_cro")).toBe("cso_cro");
  });

  it("ignores case, spacing, and punctuation", () => {
    expect(resolveRoleLevel("  VP  of  Sales  ")).toBe("vp_sales");
    expect(resolveRoleLevel("cso/cro")).toBe("cso_cro");
    expect(resolveRoleLevel("SALES PROFESSIONAL")).toBe("sales_professional");
  });

  it("defaults a blank value to sales_professional", () => {
    expect(resolveRoleLevel("")).toBe("sales_professional");
    expect(resolveRoleLevel("   ")).toBe("sales_professional");
  });

  it("returns null for a value it does not recognize (the admin maps it)", () => {
    expect(resolveRoleLevel("Account Executive")).toBeNull();
    expect(resolveRoleLevel("godmode")).toBeNull();
  });
});

describe("distinctRoleTexts / roleTextCounts", () => {
  const rows = [
    row({ email: "a@x.com", roleText: "Sales Professional" }),
    row({ email: "b@x.com", roleText: "Sales Professional" }),
    row({ email: "c@x.com", roleText: "Account Executive" }),
    row({ email: "d@x.com", roleText: "Sales Professional" }),
  ];

  it("lists distinct values in first-seen order", () => {
    expect(distinctRoleTexts(rows)).toEqual(["Sales Professional", "Account Executive"]);
  });

  it("counts rows per distinct value", () => {
    expect(roleTextCounts(rows)).toEqual({ "Sales Professional": 3, "Account Executive": 1 });
  });
});

describe("initialRoleMapping / allRolesMapped", () => {
  it("auto-resolves recognized values and leaves unrecognized ones null", () => {
    const rows = [
      row({ email: "a@x.com", roleText: "Sales Professional" }),
      row({ email: "b@x.com", roleText: "Account Executive" }),
      row({ email: "c@x.com", roleText: "" }),
    ];
    expect(initialRoleMapping(rows)).toEqual({
      "Sales Professional": "sales_professional",
      "Account Executive": null,
      "": "sales_professional",
    });
  });

  it("is not fully mapped while any distinct value is null, and is once every value is chosen", () => {
    const rows = [
      row({ email: "a@x.com", roleText: "Sales Professional" }),
      row({ email: "b@x.com", roleText: "Account Executive" }),
    ];
    const distinct = distinctRoleTexts(rows);
    const mapping = initialRoleMapping(rows);
    expect(allRolesMapped(distinct, mapping)).toBe(false);
    mapping["Account Executive"] = "sales_manager";
    expect(allRolesMapped(distinct, mapping)).toBe(true);
  });
});

describe("applyRoleMapping", () => {
  it("stamps each row with its mapped level and carries reports_to", () => {
    const rows = [
      row({ email: "a@x.com", full_name: "Alice", roleText: "Sales Professional" }),
      row({ email: "b@x.com", full_name: "Bob", roleText: "Account Executive", reports_to: "boss@x.com" }),
    ];
    const mapping = { "Sales Professional": "sales_professional" as const, "Account Executive": "sales_manager" as const };
    expect(applyRoleMapping(rows, mapping)).toEqual([
      { email: "a@x.com", full_name: "Alice", role_level: "sales_professional" },
      { email: "b@x.com", full_name: "Bob", role_level: "sales_manager", reports_to: "boss@x.com" },
    ]);
  });
});
