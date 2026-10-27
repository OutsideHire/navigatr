import { describe, it, expect } from "vitest";
import { EMPLOYEE_COUNT_OPTIONS, employeeCountLabel } from "./employeeCount";

describe("employee count buckets (FR-PORT-35, Q10)", () => {
  it("offers the same four buckets as the partner referral forms", () => {
    expect(EMPLOYEE_COUNT_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ["1-10", "1 to 10"],
      ["11-50", "11 to 50"],
      ["51-200", "51 to 200"],
      ["201+", "Over 200"],
    ]);
  });

  it("labels a known bucket", () => {
    expect(employeeCountLabel("1-10")).toBe("1 to 10");
    expect(employeeCountLabel("201+")).toBe("Over 200");
  });

  it("shows any other stored value as it is", () => {
    expect(employeeCountLabel("about 30")).toBe("about 30");
    expect(employeeCountLabel(" 1-9 ")).toBe("1-9");
  });

  it("is null when there is nothing to show", () => {
    expect(employeeCountLabel("")).toBeNull();
    expect(employeeCountLabel("   ")).toBeNull();
    expect(employeeCountLabel(null)).toBeNull();
    expect(employeeCountLabel(undefined)).toBeNull();
  });
});
